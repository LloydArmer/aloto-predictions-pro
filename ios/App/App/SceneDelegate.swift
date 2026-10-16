import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // MainViewController, NOT CAPBridgeViewController.
        //
        // This line is what creates the app's root view controller. The
        // storyboard is never consulted, because the window is built here.
        // MainViewController is the subclass that registers this app's own
        // plugins, which Capacitor has not discovered automatically since
        // version 6.
        //
        // With a plain CAPBridgeViewController, LiveActivityPlugin and
        // ReviewPlugin compile, ship, and are unreachable from JavaScript.
        // That happened for three releases without a single error anywhere.
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
