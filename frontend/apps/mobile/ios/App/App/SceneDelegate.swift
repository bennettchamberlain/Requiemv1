import UIKit
import Capacitor

// iOS 26 (Xcode 26+ SDK) requires UIScene lifecycle adoption — a real
// UIWindowSceneDelegate. Capacitor's default template still uses the legacy
// AppDelegate-window model, which now traps at launch. This delegate creates the
// window from the Main storyboard (the Capacitor bridge view controller) and
// attaches it to the window scene.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
