package com.companionintelligence.localhub.motion

import com.companionintelligence.localhub.EnqueueOutcome
import com.companionintelligence.localhub.FakeOutbox
import com.companionintelligence.localhub.outboxItem
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Records every platform call, in order, so a test can assert the exact OS footprint of a scenario. */
private class FakePlatform : MotionPlatform {
    val calls = mutableListOf<String>()
    var now = 1_000_000L
    /** False = Android refuses the foreground service (started from the background). */
    var startAllowed = true
    /** Whether the service is alive; set by an allowed start, cleared by stop -- or by a test playing process death. */
    var samplingRunning = false
    /** What the fused provider answers for its last known fix. */
    var lastKnown: GateSample? = null
    override fun watchForStillness() { calls += "watchForStillness" }
    override fun cancelSensorTriggers() { calls += "cancelSensorTriggers" }
    override fun setExitGeofence(latitude: Double, longitude: Double, radiusMeters: Float) {
        calls += "geofence($latitude,$longitude,$radiusMeters)"
    }
    override fun clearExitGeofence() { calls += "clearGeofence" }
    override fun startSampling(config: MotionTrackingConfig): Boolean {
        calls += "startSampling"
        if (startAllowed) {
            samplingRunning = true
        }
        return startAllowed
    }
    override fun stopSampling() {
        calls += "stopSampling"
        samplingRunning = false
    }
    override fun isSamplingRunning(): Boolean = samplingRunning
    override fun lastKnownLocation(onResult: (GateSample?) -> Unit) {
        calls += "lastKnownLocation"
        onResult(lastKnown)
    }
    override fun nowMs(): Long = now
}

/** In-memory state, round-tripped through JSON exactly as SharedPreferences would store it. */
private class MemoryStore : MotionStateStore {
    var raw: String? = null
    override fun load(): MotionState? = raw?.let { MotionState.fromJson(JSONObject(it)) }
    override fun save(state: MotionState) { raw = state.toJson().toString() }
    override fun clear() { raw = null }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MotionGatedTrackerTest {
    private val config = MotionTrackingConfig(
        deviceKey = "cd12ea3d-b4d5-4ba6-a1e1-b02d18653e93",
        provider = "companion-mobile",
        owner = "http://localhost:5173 abc123",
        minDistanceMeters = 150.0,
        minIntervalMs = 10 * 60 * 1000L,
        maxAccuracyMeters = 200.0,
        geofenceRadiusMeters = 200f,
        notificationTitle = "Recording location",
        notificationText = "moving",
    )
    private val platform = FakePlatform()
    private val store = MemoryStore()
    private val outbox = FakeOutbox()
    private val tracker = MotionGatedTracker(platform, store, { outbox })

    private fun fix(lat: Double, lng: Double, atMs: Long, accuracy: Double = 5.0) =
        MotionFix(lat, lng, accuracy, null, null, null, null, atMs)

    /** Ten minutes of fixes within 50 m of the last one: the fixes-based "at rest" rule. */
    private fun becomeStillViaFixes() {
        val last = store.load()!!.lastSeen!!
        platform.now += MotionGatedTracker.STILL_TIMEOUT_MS + 1_000L
        tracker.onFix(fix(last.latitude, last.longitude, platform.now))
        check(!store.load()!!.moving)
    }

    @Test
    fun `arming starts sampling at once and watches for the phone coming to rest`() {
        tracker.arm(config)

        assertEquals(listOf("clearGeofence", "startSampling", "watchForStillness"), platform.calls)
        assertTrue(tracker.isArmed)
        assertTrue(store.load()!!.moving)
    }

    @Test
    fun `a background fix is queued with the web side's record and owner`() {
        tracker.arm(config)
        tracker.appInForeground = false

        val outcome = tracker.onFix(fix(33.6767, -117.7972, 1791520516942L, accuracy = 4.0))

        assertEquals(MotionGatedTracker.FixOutcome.Queued("${config.deviceKey}:1791520516942"), outcome)
        assertEquals(1, outbox.enqueueCalls.size)
        val (kind, payload, capturedAt, key) = outbox.enqueueCalls[0]
        assertEquals("positions", kind)
        assertEquals("2026-10-09T04:35:16.942Z", capturedAt)
        assertEquals("${config.deviceKey}:1791520516942", key)
        assertEquals(config.owner, outbox.enqueueOwners[0])
        val record = JSONObject(payload).getJSONArray("records").getJSONObject(0)
        assertEquals(-117.7972, record.getJSONObject("location").getDouble("x"), 0.0)
        assertEquals("companion-mobile", record.getString("provider"))
    }

    @Test
    fun `the gate advances only on a queued fix`() {
        tracker.arm(config)

        tracker.onFix(fix(33.6767, -117.7972, 0L))
        // 10 m later, seconds later: throttled, and the gate still points at the first fix.
        val second = tracker.onFix(fix(33.6768, -117.7972, 5_000L))
        assertTrue(second is MotionGatedTracker.FixOutcome.Ignored)
        // ~160 m from the FIRST fix: passes.
        val third = tracker.onFix(fix(33.6767, -117.7955, 10_000L))
        assertTrue(third is MotionGatedTracker.FixOutcome.Queued)
        assertEquals(2, outbox.enqueueCalls.size)
    }

    @Test
    fun `a duplicate enqueue still counts as queued and notifies the listener`() {
        tracker.arm(config)
        outbox.nextEnqueueOutcome = EnqueueOutcome.Duplicate(outboxItem())
        val events = mutableListOf<JSONObject>()
        tracker.listener = { events += it }

        val outcome = tracker.onFix(fix(33.6767, -117.7972, 1791520516942L))

        assertTrue(outcome is MotionGatedTracker.FixOutcome.Queued)
        assertEquals(1, events.size)
        assertEquals(1791520516942L, events[0].getLong("time"))
    }

    @Test
    fun `fixes are ignored while the app is in the foreground`() {
        tracker.arm(config)
        tracker.appInForeground = true

        val outcome = tracker.onFix(fix(33.6767, -117.7972, 0L))

        assertTrue(outcome is MotionGatedTracker.FixOutcome.Ignored)
        assertEquals(0, outbox.enqueueCalls.size)
        // ...but the resting-spot centre still follows the phone.
        assertEquals(33.6767, store.load()!!.lastSeen!!.latitude, 0.0)
    }

    @Test
    fun `a geofence exit restarts sampling and arms the stillness sensor`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        becomeStillViaFixes()
        platform.calls.clear()

        tracker.onGeofenceExit()

        assertEquals(listOf("clearGeofence", "startSampling", "watchForStillness"), platform.calls)
        assertTrue(store.load()!!.moving)
    }

    @Test
    fun `a geofence exit whose service start is refused fences where the phone is now`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        becomeStillViaFixes()
        platform.startAllowed = false
        platform.lastKnown = GateSample(33.6800, -117.7900, platform.now)
        platform.calls.clear()

        tracker.onGeofenceExit()

        // Not the old resting spot: the phone has left it, and a fence it is outside of never fires.
        assertEquals(
            listOf("clearGeofence", "startSampling", "lastKnownLocation", "geofence(33.68,-117.79,200.0)"),
            platform.calls,
        )
        assertFalse(store.load()!!.moving)
    }

    @Test
    fun `a geofence exit while already moving is a no-op`() {
        tracker.arm(config)
        platform.calls.clear()

        tracker.onGeofenceExit()

        assertTrue(platform.calls.isEmpty())
    }

    @Test
    fun `stationary detect alone never stops sampling, it shortens the clock`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        platform.calls.clear()

        // A red light: the sensor fires seconds after the last movement.
        platform.now += 20_000L
        tracker.onStationaryDetected()
        assertEquals(listOf("watchForStillness"), platform.calls)
        assertTrue(store.load()!!.moving)

        // Three minutes with no 50 m of movement is now enough (ten without the sensor).
        platform.now += 3 * 60 * 1000L
        tracker.onFix(fix(33.6768, -117.7972, platform.now))
        assertFalse(store.load()!!.moving)
        assertEquals("stopSampling", platform.calls[1])
        assertEquals("geofence(33.6768,-117.7972,200.0)", platform.calls[2])
        assertEquals(3, platform.calls.size)
    }

    @Test
    fun `movement after a stationary report resets the short clock`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        platform.now += 20_000L
        tracker.onStationaryDetected()

        // Drove on: 160 m further.
        platform.now += 60_000L
        tracker.onFix(fix(33.6767, -117.7955, platform.now))
        assertNull(store.load()!!.stationaryNotedAtMs)

        // Three more minutes of jitter is NOT enough any more.
        platform.now += 3 * 60 * 1000L
        tracker.onFix(fix(33.6767, -117.7956, platform.now))
        assertTrue(store.load()!!.moving)
    }

    @Test
    fun `a slow walk is movement even though consecutive fixes are metres apart`() {
        // The walk that found the bug: five-second fixes ~7 m apart for twelve minutes. Each
        // fix is close to the previous one, but far from where movement was last confirmed.
        tracker.arm(config)
        var lat = 33.6952
        for (second in 0 until 12 * 60 step 5) {
            platform.now += 5_000L
            lat += 0.000063 // ~7 m north per fix
            tracker.onFix(fix(lat, -117.7481, platform.now))
        }
        assertTrue(store.load()!!.moving)
        assertTrue(platform.calls.none { it == "stopSampling" })
    }

    @Test
    fun `fixes that show no movement for ten minutes stop sampling and fence the resting spot`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        platform.calls.clear()

        // Jitter inside 50 m for nine minutes: still moving as far as the tracker knows.
        platform.now += 9 * 60 * 1000L
        tracker.onFix(fix(33.6768, -117.7972, platform.now))
        assertTrue(platform.calls.isEmpty())

        // Past ten minutes: at rest. GPS off, fence around the last fix, motion sensor armed.
        platform.now += 2 * 60 * 1000L
        val outcome = tracker.onFix(fix(33.6768, -117.7973, platform.now))
        assertTrue(outcome is MotionGatedTracker.FixOutcome.Ignored)
        assertEquals(listOf("stopSampling", "geofence(33.6768,-117.7973,200.0)"), platform.calls)
        assertFalse(store.load()!!.moving)
        assertNull(tracker.configForService())
    }

    @Test
    fun `state survives a new process`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        becomeStillViaFixes()

        // A broadcast-started process: fresh tracker, same store and outbox.
        val reborn = MotionGatedTracker(FakePlatform(), store, { outbox })
        assertTrue(reborn.isArmed)
        assertFalse(reborn.snapshot()!!.moving)
        assertEquals(config, reborn.snapshot()!!.config)
        // The gate carried over too: the same spot a second later is throttled, not queued.
        reborn.onGeofenceExit()
        val outcome = reborn.onFix(fix(33.6767, -117.7972, 1_000L))
        assertTrue(outcome is MotionGatedTracker.FixOutcome.Ignored)
    }

    @Test
    fun `coming to the foreground touches nothing but the flag while the service is running`() {
        tracker.arm(config)
        platform.calls.clear()

        tracker.onAppResumed()
        assertTrue(tracker.appInForeground)
        // No restart of a running service: that would re-post a notification the user swiped away.
        assertTrue(platform.calls.isEmpty())

        tracker.onAppPaused()
        assertFalse(tracker.appInForeground)
    }

    @Test
    fun `coming to the foreground does not restart a service that is absent because the phone is still`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        becomeStillViaFixes()
        platform.calls.clear()

        tracker.onAppResumed()

        assertTrue(platform.calls.isEmpty())
        assertFalse(store.load()!!.moving)
    }

    @Test
    fun `coming to the foreground restarts a service that died while moving`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        // The process was killed and came back with the state saying "moving" but no service.
        platform.samplingRunning = false
        platform.calls.clear()

        tracker.onAppResumed()

        assertEquals(listOf("startSampling", "watchForStillness"), platform.calls)
        assertTrue(store.load()!!.moving)
        // The still clock starts over: the fixes that would have advanced it never arrived.
        assertNull(store.load()!!.movementAnchor)
    }

    @Test
    fun `a refused service start fences the last known location instead of pretending to move`() {
        // The device case: the app was (re)installed and launched behind the lock screen, so
        // Android refused the location foreground service. Three days of trips were lost
        // because the tracker recorded "moving" with no GPS and no fence.
        platform.startAllowed = false
        platform.lastKnown = GateSample(33.6952, -117.7481, 5_000L)

        tracker.arm(config)

        assertEquals(
            listOf("clearGeofence", "startSampling", "lastKnownLocation", "geofence(33.6952,-117.7481,200.0)"),
            platform.calls,
        )
        val state = store.load()!!
        assertFalse(state.moving)
        assertEquals(33.6952, state.lastSeen!!.latitude, 0.0)
        assertNull(tracker.configForService())

        // Leaving the fence restarts sampling the exempt way, like any other departure.
        platform.startAllowed = true
        platform.calls.clear()
        tracker.onGeofenceExit()
        assertEquals(listOf("clearGeofence", "startSampling", "watchForStillness"), platform.calls)
        assertTrue(store.load()!!.moving)
    }

    @Test
    fun `a refused start with no location to fence stays wanted and is repaired on resume`() {
        platform.startAllowed = false
        platform.lastKnown = null

        tracker.arm(config)

        assertEquals(listOf("clearGeofence", "startSampling", "lastKnownLocation"), platform.calls)
        assertTrue(store.load()!!.moving)
        assertFalse(platform.samplingRunning)

        // The user unlocks the phone and opens the app: the start is allowed now.
        platform.startAllowed = true
        platform.calls.clear()
        tracker.onAppResumed()
        assertEquals(listOf("startSampling", "watchForStillness"), platform.calls)
        assertTrue(platform.samplingRunning)
    }

    @Test
    fun `a refused start falls back to the last fix this tracker saw when the platform knows nothing`() {
        tracker.arm(config)
        tracker.onFix(fix(33.6767, -117.7972, 0L))
        // Re-armed (new options) from the background: refused, and the fused provider has nothing.
        platform.startAllowed = false
        platform.lastKnown = null
        platform.samplingRunning = false
        platform.calls.clear()

        tracker.arm(config.copy(notificationText = "changed"))

        assertEquals(
            listOf("clearGeofence", "startSampling", "lastKnownLocation", "geofence(33.6767,-117.7972,200.0)"),
            platform.calls,
        )
        assertFalse(store.load()!!.moving)
    }

    @Test
    fun `a late last-known answer is ignored once sampling is running after all`() {
        // The fused provider answers asynchronously; if the service came up in the meantime
        // (the user opened the app), the stale answer must not fence a moving phone.
        var pending: ((GateSample?) -> Unit)? = null
        val deferring = object : MotionPlatform by platform {
            override fun lastKnownLocation(onResult: (GateSample?) -> Unit) { pending = onResult }
        }
        val deferred = MotionGatedTracker(deferring, store, { outbox })
        platform.startAllowed = false
        deferred.arm(config)
        assertTrue(store.load()!!.moving)

        platform.startAllowed = true
        deferred.onAppResumed()
        platform.calls.clear()
        pending!!(GateSample(33.6952, -117.7481, 5_000L))

        assertTrue(platform.calls.isEmpty())
        assertTrue(store.load()!!.moving)
    }

    @Test
    fun `disarming tears everything down and forgets the state`() {
        tracker.arm(config)
        platform.calls.clear()

        tracker.disarm()

        assertEquals(listOf("stopSampling", "clearGeofence", "cancelSensorTriggers"), platform.calls)
        assertFalse(tracker.isArmed)
        assertNull(store.load())
        assertTrue(tracker.onFix(fix(1.0, 2.0, 0L)) is MotionGatedTracker.FixOutcome.Ignored)
    }

    @Test
    fun `an outbox failure leaves the gate where it was`() {
        tracker.arm(config)
        outbox.thrown = RuntimeException("disk full")

        val outcome = tracker.onFix(fix(33.6767, -117.7972, 0L))

        assertTrue(outcome is MotionGatedTracker.FixOutcome.Failed)
        assertNull(store.load()!!.lastAccepted)
    }

    @Test
    fun `a capacity refusal is a failure, not a silent drop`() {
        tracker.arm(config)
        outbox.nextEnqueueOutcome = EnqueueOutcome.AtCapacity

        assertEquals(MotionGatedTracker.FixOutcome.Failed("outbox at capacity"), tracker.onFix(fix(33.6767, -117.7972, 0L)))
    }

    @Test
    fun `config round-trips through JSON with defaults for what JS leaves out`() {
        val parsed = MotionTrackingConfig.fromJson(JSONObject().put("deviceKey", "k"))!!
        assertEquals(MotionTrackingConfig.DEFAULT_MIN_DISTANCE_METERS, parsed.minDistanceMeters, 0.0)
        assertEquals(MotionTrackingConfig.DEFAULT_MIN_INTERVAL_MS, parsed.minIntervalMs)
        assertNull(parsed.owner)
        assertEquals(config, MotionTrackingConfig.fromJson(config.toJson()))
        assertNull(MotionTrackingConfig.fromJson(JSONObject().put("deviceKey", "  ")))
    }
}
