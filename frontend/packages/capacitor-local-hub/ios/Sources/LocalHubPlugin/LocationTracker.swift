import CoreLocation
import Foundation
import UIKit

/// Native location sampler. WKWebView geolocation dies when the app is backgrounded;
/// this writes the same `positions` outbox envelope `captureLocationFix` builds.
///
/// Always mode uses significant-change + an optional home geofence, then a short
/// high-accuracy burst. It does not stream GPS in the background.
final class LocationTracker: NSObject, CLLocationManagerDelegate {
    static let shared = LocationTracker()

    enum Mode: String {
        case off
        case whenInUse = "when_in_use"
        case always
    }

    private static let modeDefaultsKey = "ci.location.mode"
    private static let deviceKeyDefaultsKey = "ci.location.deviceKey"
    private static let lastFixDefaultsKey = "ci.location.lastFixAt"
    private static let homeRegionId = "ci.location.home"
    private static let positionsKind = "positions"

    private static let foregroundMinDistanceMeters = 50.0
    private static let foregroundMinInterval: TimeInterval = 5 * 60
    private static let backgroundMinDistanceMeters = 150.0
    private static let backgroundMinInterval: TimeInterval = 10 * 60
    private static let backgroundMaxAccuracyMeters = 200.0
    private static let homeRadiusMeters = 200.0
    private static let burstDuration: TimeInterval = 45
    private static let burstMaxFixes = 3

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let lock = NSLock()

    private weak var server: LocalHubServer?
    private var mode: Mode = .off
    private var deviceKey: String = ""
    private var lastAccepted: (lat: Double, lng: Double, at: TimeInterval)?
    private var burstDeadline: Date?
    private var burstCount = 0
    private var lastError: String?
    private var lastFixAt: String?
    private var pendingAlways = false
    private var didRequestAlways = false
    private var pendingResolvers: [( [String: Any] ) -> Void] = []

    override private init() {
        super.init()
        manager.delegate = self
        manager.pausesLocationUpdatesAutomatically = true
        manager.activityType = .other
        if let stored = defaults.string(forKey: Self.modeDefaultsKey), let restored = Mode(rawValue: stored) {
            mode = restored
        }
        deviceKey = defaults.string(forKey: Self.deviceKeyDefaultsKey) ?? ""
        lastFixAt = defaults.string(forKey: Self.lastFixDefaultsKey)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    func attach(server: LocalHubServer) {
        self.server = server
    }

    /// Re-apply a persisted Always/While-using mode after reboot, before JS loads.
    func restoreIfNeeded() {
        guard mode != .off, !deviceKey.isEmpty else { return }
        applySampling()
    }

    func setMode(_ raw: String, deviceKey: String, resolve: @escaping ([String: Any]) -> Void) {
        let next = Mode(rawValue: raw) ?? .off
        self.deviceKey = deviceKey
        defaults.set(deviceKey, forKey: Self.deviceKeyDefaultsKey)
        mode = next
        defaults.set(next.rawValue, forKey: Self.modeDefaultsKey)
        lastError = nil
        if next != .always {
            pendingAlways = false
            didRequestAlways = false
        }
        lock.lock()
        pendingResolvers.append(resolve)
        lock.unlock()
        requestAuthorizationThenStart()
        // If authorization will not change (already granted / off), resolve now.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.flushResolversIfSettled()
        }
    }

    func status() -> [String: Any] {
        statusDictionary()
    }

    func setHome(latitude: Double?, longitude: Double?) {
        if let existing = manager.monitoredRegions.first(where: { $0.identifier == Self.homeRegionId }) {
            manager.stopMonitoring(for: existing)
        }
        guard mode == .always, let latitude, let longitude else { return }
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            radius: Self.homeRadiusMeters,
            identifier: Self.homeRegionId
        )
        region.notifyOnEntry = true
        region.notifyOnExit = true
        manager.startMonitoring(for: region)
    }

    // MARK: - Authorization + sampling

    private func requestAuthorizationThenStart() {
        if mode == .off {
            stopAll()
            flushResolvers()
            return
        }

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            if mode == .always, !didRequestAlways {
                didRequestAlways = true
                pendingAlways = true
                manager.requestAlwaysAuthorization()
            } else {
                pendingAlways = false
                applySampling()
                flushResolvers()
            }
        case .authorizedAlways:
            pendingAlways = false
            applySampling()
            flushResolvers()
        default:
            pendingAlways = false
            stopAll()
            flushResolvers()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        requestAuthorizationThenStart()
    }

    private func applySampling() {
        switch mode {
        case .off:
            stopAll()
        case .whenInUse:
            manager.allowsBackgroundLocationUpdates = false
            manager.showsBackgroundLocationIndicator = false
            manager.stopMonitoringSignificantLocationChanges()
            stopHomeRegion()
            if UIApplication.shared.applicationState != .background {
                manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
                manager.startUpdatingLocation()
            } else {
                manager.stopUpdatingLocation()
            }
        case .always:
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.desiredAccuracy = kCLLocationAccuracyKilometer
            manager.startMonitoringSignificantLocationChanges()
            if UIApplication.shared.applicationState != .background {
                manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
                manager.startUpdatingLocation()
            }
        }
    }

    private func stopAll() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        manager.showsBackgroundLocationIndicator = false
        stopHomeRegion()
        burstDeadline = nil
        burstCount = 0
    }

    private func stopHomeRegion() {
        if let existing = manager.monitoredRegions.first(where: { $0.identifier == Self.homeRegionId }) {
            manager.stopMonitoring(for: existing)
        }
    }

    @objc private func appDidEnterBackground() {
        if mode == .whenInUse {
            manager.stopUpdatingLocation()
        } else if mode == .always {
            manager.stopUpdatingLocation()
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    @objc private func appWillEnterForeground() {
        if mode == .whenInUse || mode == .always {
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.startUpdatingLocation()
        }
    }

    // MARK: - Fixes

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations {
            accept(location)
        }
        if let deadline = burstDeadline {
            if burstCount >= Self.burstMaxFixes || Date() >= deadline {
                endBurst()
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard region.identifier == Self.homeRegionId, mode == .always else { return }
        beginBurst()
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier == Self.homeRegionId, mode == .always else { return }
        beginBurst()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        lastError = error.localizedDescription
    }

    private func beginBurst() {
        burstDeadline = Date().addingTimeInterval(Self.burstDuration)
        burstCount = 0
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.startUpdatingLocation()
    }

    private func endBurst() {
        burstDeadline = nil
        burstCount = 0
        manager.stopUpdatingLocation()
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    private func accept(_ location: CLLocation) {
        let accuracy = location.horizontalAccuracy
        guard accuracy > 0 else { return }

        let background = UIApplication.shared.applicationState == .background || mode == .always
        if background && burstDeadline != nil && accuracy > Self.backgroundMaxAccuracyMeters {
            return
        }
        if UIApplication.shared.applicationState == .background && accuracy > Self.backgroundMaxAccuracyMeters {
            return
        }

        let now = location.timestamp.timeIntervalSince1970
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let minDistance = (mode == .always && UIApplication.shared.applicationState == .background)
            ? Self.backgroundMinDistanceMeters
            : Self.foregroundMinDistanceMeters
        let minInterval = (mode == .always && UIApplication.shared.applicationState == .background)
            ? Self.backgroundMinInterval
            : Self.foregroundMinInterval

        if let last = lastAccepted {
            let from = CLLocation(latitude: last.lat, longitude: last.lng)
            let moved = from.distance(from: location)
            if moved < minDistance && (now - last.at) < minInterval {
                return
            }
        }

        do {
            try enqueue(location: location)
            lastAccepted = (lat, lng, now)
            if burstDeadline != nil {
                burstCount += 1
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func enqueue(location: CLLocation) throws {
        guard !deviceKey.isEmpty else {
            throw NSError(domain: "LocationTracker", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Missing device key"
            ])
        }
        guard let server = server else {
            throw NSError(domain: "LocationTracker", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Local Hub is not attached"
            ])
        }

        let capturedAtMs = location.timestamp.timeIntervalSince1970 * 1000
        let sourceId = "\(deviceKey):\(Int(capturedAtMs))"
        let iso = iso8601(location.timestamp)
        var record: [String: Any] = [
            "time": iso,
            "location": ["x": location.coordinate.longitude, "y": location.coordinate.latitude],
            "source": "gps",
            "provider": "companion-mobile",
            "source_type": "device",
            "source_system": "companion-device",
            "source_id": sourceId
        ]
        if location.horizontalAccuracy > 0 {
            record["accuracy_meters"] = location.horizontalAccuracy
        }
        if location.verticalAccuracy >= 0 {
            record["altitude_meters"] = location.altitude
        }
        if location.course >= 0 && location.course <= 360 {
            record["heading_degrees"] = location.course
        }
        if location.speed >= 0 {
            record["speed_meters_per_second"] = location.speed
        }

        let payload = try JSONSerialization.data(withJSONObject: ["records": [record]], options: [])
        guard let payloadJSON = String(data: payload, encoding: .utf8) else {
            throw NSError(domain: "LocationTracker", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Could not encode position payload"
            ])
        }

        let store = try server.ensureOutbox()
        _ = try store.enqueue(
            kind: Self.positionsKind,
            payloadJSON: payloadJSON,
            capturedAt: iso,
            idempotencyKey: sourceId
        )
        lastFixAt = iso
        lastError = nil
        defaults.set(iso, forKey: Self.lastFixDefaultsKey)
    }

    private func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func authorizationRaw() -> String {
        switch manager.authorizationStatus {
        case .notDetermined: return "not_determined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .authorizedWhenInUse: return "when_in_use"
        case .authorizedAlways: return "always"
        @unknown default: return "not_determined"
        }
    }

    private func statusDictionary() -> [String: Any] {
        var result: [String: Any] = [
            "mode": mode.rawValue,
            "authorization": authorizationRaw(),
            "pendingAlways": pendingAlways
        ]
        if let lastFixAt {
            result["lastFixAt"] = lastFixAt
        }
        if let lastError {
            result["lastError"] = lastError
        }
        return result
    }

    private func flushResolversIfSettled() {
        if manager.authorizationStatus != .notDetermined, !pendingAlways {
            flushResolvers()
        }
    }

    private func flushResolvers() {
        lock.lock()
        let resolvers = pendingResolvers
        pendingResolvers.removeAll()
        lock.unlock()
        let payload = statusDictionary()
        resolvers.forEach { $0(payload) }
    }
}
