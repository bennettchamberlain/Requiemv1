package com.companionintelligence.localhub.motion

import android.content.Context
import com.companionintelligence.localhub.OutboxStores

/**
 * The one [MotionGatedTracker] per process. Receivers, the service and the plugin all reach
 * it through here, so a process Android spun up for a single broadcast gets a tracker wired to
 * the real platform and the shared outbox without any plugin having loaded.
 */
object MotionTracking {
    @Volatile
    private var tracker: MotionGatedTracker? = null

    fun get(context: Context): MotionGatedTracker {
        tracker?.let { return it }
        synchronized(this) {
            tracker?.let { return it }
            val app = context.applicationContext
            val created = MotionGatedTracker(
                platform = PlayServicesMotionPlatform(app),
                store = SharedPreferencesMotionStateStore(app),
                outbox = { OutboxStores.shared(app) },
            )
            tracker = created
            return created
        }
    }
}
