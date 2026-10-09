package com.companionintelligence.localhub.motion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionSamplingGateTest {
    private val config = MotionTrackingConfig(
        deviceKey = "k",
        provider = "companion-mobile",
        owner = null,
        minDistanceMeters = 150.0,
        minIntervalMs = 10 * 60 * 1000L,
        maxAccuracyMeters = 200.0,
        geofenceRadiusMeters = 200f,
        notificationTitle = "t",
        notificationText = "x",
    )

    @Test
    fun `the first fix always passes`() {
        assertEquals(MotionSamplingGate.Decision.Accept, MotionSamplingGate.decide(config, null, 33.0, -117.0, 5.0, 1_000L))
    }

    @Test
    fun `moving far enough passes before the interval`() {
        val last = GateSample(33.6767, -117.7972, 0L)
        // ~160 m east at this latitude
        val decision = MotionSamplingGate.decide(config, last, 33.6767, -117.7955, 5.0, 9_000L)
        assertEquals(MotionSamplingGate.Decision.Accept, decision)
    }

    @Test
    fun `waiting long enough passes without moving`() {
        val last = GateSample(33.6767, -117.7972, 0L)
        val decision = MotionSamplingGate.decide(config, last, 33.6767, -117.7972, 5.0, 10 * 60 * 1000L)
        assertEquals(MotionSamplingGate.Decision.Accept, decision)
    }

    @Test
    fun `neither far nor long is rejected`() {
        val last = GateSample(33.6767, -117.7972, 0L)
        val decision = MotionSamplingGate.decide(config, last, 33.6768, -117.7972, 5.0, 60_000L)
        assertTrue(decision is MotionSamplingGate.Decision.Reject)
    }

    @Test
    fun `a loose fix is rejected even when far and late`() {
        val last = GateSample(33.6767, -117.7972, 0L)
        val decision = MotionSamplingGate.decide(config, last, 34.0, -117.0, 250.0, 60 * 60 * 1000L)
        assertTrue(decision is MotionSamplingGate.Decision.Reject)
    }

    @Test
    fun `out of range coordinates are rejected`() {
        assertTrue(MotionSamplingGate.decide(config, null, 91.0, 0.0, 5.0, 0L) is MotionSamplingGate.Decision.Reject)
        assertTrue(MotionSamplingGate.decide(config, null, 0.0, 181.0, 5.0, 0L) is MotionSamplingGate.Decision.Reject)
        assertTrue(MotionSamplingGate.decide(config, null, Double.NaN, 0.0, 5.0, 0L) is MotionSamplingGate.Decision.Reject)
    }

    @Test
    fun `haversine agrees with the web side to the metre`() {
        // Irvine to a point ~1 km north: the web test's haversineMeters gives 1111 m per 0.01 deg lat.
        val metres = MotionSamplingGate.haversineMeters(33.6767, -117.7972, 33.6867, -117.7972)
        assertEquals(1111.0, metres, 2.0)
    }
}
