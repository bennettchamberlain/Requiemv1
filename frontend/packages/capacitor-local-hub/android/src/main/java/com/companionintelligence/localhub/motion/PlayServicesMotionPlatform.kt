package com.companionintelligence.localhub.motion

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * [MotionPlatform] on the device: Google Play Services for the exit geofence,
 * [MotionLocationService] for the GPS itself, and one permission-free one-shot sensor,
 * stationary detect (five seconds at rest), which is only armed while that service runs.
 * Optional hardware; a device without it leans on the fixes-based rule alone.
 *
 * There is deliberately no significant-motion trigger here any more. It needs the app to be
 * eligible for sensor events, which a backgrounded app with no foreground service is not
 * (Android 9+), so it could only ever fire while the app was on screen. See
 * [MotionGatedTracker]'s class docs for the device evidence.
 *
 * The geofence PendingIntent is an explicit broadcast to this module's own (non-exported)
 * receiver. It is `FLAG_MUTABLE` because Play Services fills the result extras into the
 * intent it sends, which an immutable PendingIntent forbids; from API 31 one of the two
 * flags is mandatory and this is the one that works.
 *
 * Failures here are logged, not thrown: a missing Play Services, a revoked permission or a
 * transient GMS error must not take the plugin call down with it. The consequence of a lost
 * registration is the previous behaviour (GPS stays on until the fixes say still), never a
 * crash in a broadcast receiver.
 */
class PlayServicesMotionPlatform(context: Context) : MotionPlatform {
    private val app = context.applicationContext

    private val sensors: SensorManager? = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val stationaryDetect: Sensor? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) sensors?.getDefaultSensor(Sensor.TYPE_STATIONARY_DETECT) else null

    private val stillnessListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            MotionTracking.get(app).onStationaryDetected()
        }
    }

    override fun watchForStillness() {
        val sensor = stationaryDetect ?: return
        // A trigger sensor is one-shot and cancels itself on firing; cancelling first makes
        // re-arming idempotent.
        sensors?.cancelTriggerSensor(stillnessListener, sensor)
        if (sensors?.requestTriggerSensor(stillnessListener, sensor) != true) {
            Log.w(TAG, "stationary-detect trigger not armed")
        }
    }

    override fun cancelSensorTriggers() {
        stationaryDetect?.let { sensors?.cancelTriggerSensor(stillnessListener, it) }
    }

    override fun setExitGeofence(latitude: Double, longitude: Double, radiusMeters: Float, onDone: (Boolean) -> Unit) {
        val fence = Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(latitude, longitude, radiusMeters)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        val request = GeofencingRequest.Builder()
            // No initial trigger: the phone is inside the fence by construction, and an
            // immediate EXIT from a stale fix would just switch GPS straight back on.
            .setInitialTrigger(0)
            .addGeofence(fence)
            .build()
        try {
            LocationServices.getGeofencingClient(app)
                .addGeofences(request, geofenceIntent())
                .addOnSuccessListener { onDone(true) }
                .addOnFailureListener {
                    Log.w(TAG, "exit geofence not set: ${it.message}")
                    onDone(false)
                }
        } catch (e: SecurityException) {
            Log.w(TAG, "exit geofence needs background location: ${e.message}")
            onDone(false)
        }
    }

    override fun clearExitGeofence() {
        LocationServices.getGeofencingClient(app).removeGeofences(geofenceIntent())
    }

    override fun startSampling(config: MotionTrackingConfig): Boolean {
        val intent = Intent(app, MotionLocationService::class.java)
            .putExtra(MotionLocationService.EXTRA_TITLE, config.notificationTitle)
            .putExtra(MotionLocationService.EXTRA_TEXT, config.notificationText)
        return try {
            ContextCompat.startForegroundService(app, intent)
            true
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (API 31+): the start came from
            // somewhere Android does not exempt -- seen on a device when the app was launched
            // behind the lock screen (uid state TOP_SLEEPING). The tracker falls back to a
            // geofence, whose exit IS exempt.
            Log.w(TAG, "location service not started: ${e.message}")
            false
        }
    }

    override fun stopSampling() {
        app.stopService(Intent(app, MotionLocationService::class.java))
    }

    override fun isSamplingRunning(): Boolean = MotionLocationService.isRunning

    override fun lastKnownLocation(onResult: (GateSample?) -> Unit) {
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            onResult(null)
            return
        }
        try {
            LocationServices.getFusedLocationProviderClient(app).lastLocation
                .addOnSuccessListener { location ->
                    onResult(location?.let { GateSample(it.latitude, it.longitude, it.time) })
                }
                .addOnFailureListener {
                    Log.w(TAG, "last known location unavailable: ${it.message}")
                    onResult(null)
                }
        } catch (e: SecurityException) {
            Log.w(TAG, "last known location refused: ${e.message}")
            onResult(null)
        }
    }

    override fun nowMs(): Long = System.currentTimeMillis()

    private fun geofenceIntent(): PendingIntent = PendingIntent.getBroadcast(
        app,
        REQUEST_GEOFENCE,
        Intent(app, MotionGeofenceReceiver::class.java).setAction(MotionGeofenceReceiver.ACTION),
        pendingFlags(),
    )

    private fun pendingFlags(): Int {
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return flags
    }

    private companion object {
        const val TAG = "MotionPlatform"
        const val GEOFENCE_ID = "ci-resting-spot"
        const val REQUEST_GEOFENCE = 4102
    }
}
