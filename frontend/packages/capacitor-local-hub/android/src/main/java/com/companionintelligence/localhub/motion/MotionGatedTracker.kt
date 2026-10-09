package com.companionintelligence.localhub.motion

import com.companionintelligence.localhub.EnqueueOutcome
import com.companionintelligence.localhub.OutboxQueue
import org.json.JSONObject

/**
 * What the tracker needs from the OS, behind an interface so the state machine runs under a
 * plain JVM test with a fake. [PlayServicesMotionPlatform] is the real one.
 */
interface MotionPlatform {
    /**
     * Arm the one-shot stationary-detect trigger (five seconds at rest; no permission). Fires
     * [MotionGatedTracker.onStationaryDetected] once, then must be armed again. Only armed
     * while the location service runs: that service is what keeps the app eligible for
     * sensor events at all (see the class docs), so this is also the only time it can fire.
     */
    fun watchForStillness()
    fun cancelSensorTriggers()
    /** One exit geofence around where the phone came to rest, delivered to [MotionGeofenceReceiver]. */
    fun setExitGeofence(latitude: Double, longitude: Double, radiusMeters: Float)
    fun clearExitGeofence()
    /** Start the foreground location service (GPS on). */
    fun startSampling(config: MotionTrackingConfig)
    /** Stop it (GPS off). */
    fun stopSampling()
    fun nowMs(): Long
}

/** Everything the tracker must remember across process deaths. */
data class MotionState(
    val config: MotionTrackingConfig,
    val moving: Boolean,
    /** The last fix actually queued -- what the distance/interval gate compares against. */
    val lastAccepted: GateSample?,
    /** The last fix seen at all, queued or not -- the geofence centre when the phone stops. */
    val lastSeen: GateSample?,
    /** When the phone last moved [MotionGatedTracker.STILL_MOVEMENT_METERS] from [movementAnchor]; the self-detected-still clock. */
    val lastMovementAtMs: Long,
    /**
     * Where the phone was when movement was last confirmed. The still rule measures every fix
     * against THIS, never against the previous fix: at walking pace consecutive five-second
     * fixes are a few metres apart and would never clear 50 m, which once stopped sampling
     * ten minutes into a walk. Null until the first fix.
     */
    val movementAnchor: GateSample? = null,
    /** When the stationary-detect sensor last fired with no movement since; null once the phone moves. */
    val stationaryNotedAtMs: Long? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("config", config.toJson())
        .put("moving", moving)
        .put("lastAccepted", lastAccepted?.let(::sampleJson) ?: JSONObject.NULL)
        .put("lastSeen", lastSeen?.let(::sampleJson) ?: JSONObject.NULL)
        .put("lastMovementAtMs", lastMovementAtMs)
        .put("movementAnchor", movementAnchor?.let(::sampleJson) ?: JSONObject.NULL)
        .put("stationaryNotedAtMs", stationaryNotedAtMs ?: JSONObject.NULL)

    companion object {
        fun fromJson(json: JSONObject): MotionState? {
            val config = json.optJSONObject("config")?.let(MotionTrackingConfig::fromJson) ?: return null
            return MotionState(
                config = config,
                moving = json.optBoolean("moving", true),
                lastAccepted = json.optJSONObject("lastAccepted")?.let(::sampleFromJson),
                lastSeen = json.optJSONObject("lastSeen")?.let(::sampleFromJson),
                lastMovementAtMs = json.optLong("lastMovementAtMs", 0L),
                movementAnchor = json.optJSONObject("movementAnchor")?.let(::sampleFromJson),
                stationaryNotedAtMs = if (json.isNull("stationaryNotedAtMs")) null else json.optLong("stationaryNotedAtMs"),
            )
        }

        private fun sampleJson(sample: GateSample): JSONObject = JSONObject()
            .put("latitude", sample.latitude)
            .put("longitude", sample.longitude)
            .put("atMs", sample.atMs)

        private fun sampleFromJson(json: JSONObject): GateSample? {
            val latitude = json.optDouble("latitude")
            val longitude = json.optDouble("longitude")
            if (!latitude.isFinite() || !longitude.isFinite()) {
                return null
            }
            return GateSample(latitude, longitude, json.optLong("atMs", 0L))
        }
    }
}

/** Durable home for [MotionState]; [SharedPreferencesMotionStateStore] in production. */
interface MotionStateStore {
    fun load(): MotionState?
    fun save(state: MotionState)
    fun clear()
}

/**
 * Motion-gated background sampling for Android's Always mode.
 *
 * The problem this replaces: `@capacitor-community/background-geolocation` holds a
 * high-accuracy, once-per-second location request for as long as its background watcher
 * exists, and its distance filter only decides which fixes are *delivered*. The GPS receiver
 * stays on around the clock, including the many hours a phone spends sitting still, and that
 * one request was measured at roughly a quarter of the phone's daily drain.
 *
 * The rule here is that GPS runs only while the phone is moving, and every signal used to
 * decide that needs nothing beyond the location grants Always already holds. The
 * activity-recognition API would be the obvious tool and is deliberately NOT used: it is a
 * separate "Physical activity" runtime permission that reads as a different kind of
 * monitoring than location, and iOS's equivalent (significant-change monitoring) asks for
 * nothing of the sort.
 *
 * - **Moving → still** comes from the fixes themselves: no [STILL_MOVEMENT_METERS] of
 *   movement from where movement was last confirmed for [STILL_TIMEOUT_MS], or for the
 *   shorter [STILL_CONFIRMED_TIMEOUT_MS] once the permission-free stationary-detect sensor
 *   has reported the phone physically at rest. The location service stops and an exit
 *   geofence is set around the resting spot.
 * - **Still → moving** comes from the geofence exit, and only from that. Android evaluates
 *   the fence with cheap location, it survives this process being frozen or killed, and it
 *   is on Android's list of events that permit starting a location foreground service from
 *   the background -- which is what makes this work after the WebView is long gone. The
 *   price is that the first stretch of every trip, the fence radius plus Play Services'
 *   evaluation latency, is not sampled; a trip shorter than the radius is not sampled at all.
 *
 * Why no sensor fills that gap: since Android 9 an app in the background with no foreground
 * service receives no sensor events, one-shot triggers included. On a device the
 * significant-motion trigger fired for the system's own listeners while this app's,
 * registered the same way, never heard it -- the app had been frozen a minute after the
 * stop. The activity-recognition API is the OS-sanctioned way around that, by delivering
 * through Play Services as a PendingIntent, and it is exactly the permission this design
 * declines. The stationary sensor is unaffected because it is only needed while the
 * service is running, which keeps the app eligible.
 *
 * Every fix that clears [MotionSamplingGate] is queued straight into the encrypted outbox
 * from native code, with the record the web side would have built ([PositionRecordJson]), so
 * nothing depends on JavaScript being alive. When the plugin *is* alive it is told as well
 * (`significantLocation`), and the web side's own enqueue of the same fix collapses on the
 * shared `source_id`.
 *
 * Fixes are ignored while the app is in the foreground ([appInForeground]): the web side's
 * foreground watcher owns that case with its tighter 50 m / 5 min gate, and recording both
 * would double the density of every walk taken with the app open.
 *
 * All state lives in [MotionStateStore] so a process the OS created just to deliver one
 * broadcast picks up where the previous one left off. Methods are synchronized; they are
 * called from the main thread (receivers, sensors, service) and the plugin's IO scope.
 */
class MotionGatedTracker(
    private val platform: MotionPlatform,
    private val store: MotionStateStore,
    private val outbox: () -> OutboxQueue,
) {
    /** Set by the plugin while the activity is resumed. Fixes are not queued while true. */
    @Volatile
    var appInForeground: Boolean = false

    /** The plugin's event sink while a WebView exists; null in a broadcast-only process. */
    @Volatile
    var listener: ((JSONObject) -> Unit)? = null

    private var state: MotionState? = null
    private var loaded = false

    val isArmed: Boolean
        get() = synchronized(this) { current() != null }

    /** Snapshot for diagnostics (`getStatus`-style reads); never mutated through. */
    fun snapshot(): MotionState? = synchronized(this) { current()?.copy() }

    /** Arm, or re-arm with new options. Starts sampling at once: a phone being configured is in hand. */
    fun arm(config: MotionTrackingConfig) = synchronized(this) {
        val previous = current()
        val next = MotionState(
            config = config,
            moving = true,
            lastAccepted = previous?.lastAccepted,
            lastSeen = previous?.lastSeen,
            lastMovementAtMs = platform.nowMs(),
        )
        persist(next)
        platform.clearExitGeofence()
        platform.startSampling(config)
        platform.watchForStillness()
    }

    fun disarm() = synchronized(this) {
        platform.stopSampling()
        platform.clearExitGeofence()
        platform.cancelSensorTriggers()
        state = null
        loaded = true
        store.clear()
    }

    /**
     * Foreground tracking only; deliberately no side effects. An earlier revision re-started
     * the location service here so a notification dropped while notifications were denied
     * would reappear after the grant, but that re-post also undid every swipe-away for the
     * rest of a trip. A dismissed indicator now stays dismissed until the next stop and start.
     */
    fun onAppResumed() {
        appInForeground = true
    }

    fun onAppPaused() {
        appInForeground = false
    }

    /** The exit geofence fired: the phone left its resting spot. */
    fun onGeofenceExit() = synchronized(this) {
        val now = current() ?: return
        if (now.moving) {
            return
        }
        becomeMoving(now)
    }

    /**
     * The stationary-detect trigger fired: five seconds physically at rest. A red light does
     * that too, so this never stops sampling by itself -- it only shortens the clock the fixes
     * are judged against, and stops now if that shorter clock has already run out.
     */
    fun onStationaryDetected() = synchronized(this) {
        val now = current() ?: return
        if (!now.moving) {
            return
        }
        val noted = now.copy(stationaryNotedAtMs = now.stationaryNotedAtMs ?: platform.nowMs())
        if (platform.nowMs() - noted.lastMovementAtMs >= STILL_CONFIRMED_TIMEOUT_MS) {
            becomeStill(noted)
            return
        }
        persist(noted)
        // One-shot sensor: arm it again so the next rest is noticed too.
        platform.watchForStillness()
    }

    /** The location service restarted (e.g. START_STICKY) and needs its config. */
    fun configForService(): MotionTrackingConfig? = synchronized(this) { current()?.takeIf { it.moving }?.config }

    /** One OS fix from the foreground location service. */
    fun onFix(fix: MotionFix): FixOutcome = synchronized(this) {
        val now = current() ?: return FixOutcome.Ignored("not armed")
        val seen = GateSample(fix.latitude, fix.longitude, fix.capturedAtMs)
        var next = now.copy(lastSeen = seen)

        // Self-detected still: no activity recognition needed. Measured against the anchor
        // where movement was last confirmed -- not the previous fix (see MotionState) and not
        // the last queued fix (which the 150 m gate keeps far behind a slow walker).
        val movedFromAnchor = now.movementAnchor?.let {
            MotionSamplingGate.haversineMeters(it.latitude, it.longitude, fix.latitude, fix.longitude)
        }
        if (movedFromAnchor == null || movedFromAnchor >= STILL_MOVEMENT_METERS) {
            next = next.copy(lastMovementAtMs = platform.nowMs(), movementAnchor = seen, stationaryNotedAtMs = null)
        } else {
            val timeout = if (now.stationaryNotedAtMs != null) STILL_CONFIRMED_TIMEOUT_MS else STILL_TIMEOUT_MS
            if (platform.nowMs() - now.lastMovementAtMs >= timeout) {
                persist(next)
                becomeStill(next)
                return FixOutcome.Ignored("still for ${timeout}ms; sampling stopped")
            }
        }

        if (appInForeground) {
            persist(next)
            return FixOutcome.Ignored("app in foreground; web watcher owns sampling")
        }

        val decision = MotionSamplingGate.decide(
            now.config,
            now.lastAccepted,
            fix.latitude,
            fix.longitude,
            fix.accuracyMeters,
            fix.capturedAtMs,
        )
        if (decision is MotionSamplingGate.Decision.Reject) {
            persist(next)
            return FixOutcome.Ignored(decision.reason)
        }

        val record = PositionRecordJson.record(fix, now.config.deviceKey, now.config.provider)
        if (record == null) {
            persist(next)
            return FixOutcome.Ignored("unusable fix")
        }
        val outcome = try {
            outbox().enqueue(
                kind = PositionRecordJson.OUTBOX_KIND,
                payloadJson = PositionRecordJson.payload(record).toString(),
                capturedAt = record.getString("time"),
                idempotencyKey = record.getString("source_id"),
                owner = now.config.owner,
            )
        } catch (e: Exception) {
            persist(next)
            return FixOutcome.Failed(e.message ?: e.javaClass.simpleName)
        }
        return when (outcome) {
            is EnqueueOutcome.Created, is EnqueueOutcome.Duplicate -> {
                persist(next.copy(lastAccepted = seen))
                listener?.invoke(PositionRecordJson.eventBody(fix))
                FixOutcome.Queued(record.getString("source_id"))
            }
            EnqueueOutcome.AtCapacity -> {
                persist(next)
                FixOutcome.Failed("outbox at capacity")
            }
        }
    }

    sealed class FixOutcome {
        data class Queued(val sourceId: String) : FixOutcome()
        data class Ignored(val reason: String) : FixOutcome()
        data class Failed(val message: String) : FixOutcome()
    }

    private fun becomeStill(now: MotionState) {
        platform.stopSampling()
        val centre = now.lastSeen
        if (centre != null) {
            platform.setExitGeofence(centre.latitude, centre.longitude, now.config.geofenceRadiusMeters)
        }
        persist(now.copy(moving = false, stationaryNotedAtMs = null))
    }

    private fun becomeMoving(now: MotionState) {
        platform.clearExitGeofence()
        // A fresh anchor comes with the first fix of the new session.
        persist(now.copy(moving = true, lastMovementAtMs = platform.nowMs(), movementAnchor = null, stationaryNotedAtMs = null))
        platform.startSampling(now.config)
        platform.watchForStillness()
    }

    private fun current(): MotionState? {
        if (!loaded) {
            state = store.load()
            loaded = true
        }
        return state
    }

    private fun persist(next: MotionState) {
        state = next
        loaded = true
        store.save(next)
    }

    companion object {
        /** Fixes closer together than this, for the timeout in force, count as "not moving". */
        const val STILL_MOVEMENT_METERS = 50.0
        /** The clock when nothing but the fixes says the phone is at rest. */
        const val STILL_TIMEOUT_MS = 10L * 60L * 1000L
        /** The clock once the stationary-detect sensor has confirmed the phone is physically at rest. */
        const val STILL_CONFIRMED_TIMEOUT_MS = 3L * 60L * 1000L
    }
}
