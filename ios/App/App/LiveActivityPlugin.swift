//
//  LiveActivityPlugin.swift
//  App
//
//  Lets the web app start, update and end a gameweek Live Activity, and lets
//  the SERVER start one while the app is closed (push-to-start, iOS 17.2+).
//
//  Goes in ios/App/App/ — the APP target, not the widget. The widget draws the
//  activity; the app owns it.
//
//  Two kinds of token, both handled here:
//
//    The push-to-start token (iOS 17.2+). One per device. It lets the server
//    START an activity with the app closed. Collected when the app launches and
//    handed to the web app, which saves it against the signed-in account.
//
//    Each activity's own update token. It lets the server UPDATE that one
//    activity. For an activity the app started, it goes to the web app as
//    before. For one the SERVER started, the app may only have been woken
//    briefly in the background, with no web page running to save anything — so
//    this file posts it to the server itself, using the endpoint and key the
//    web app stored earlier with configure().
//

import Foundation
import UIKit
import Capacitor
import ActivityKit

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start",               returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update",              returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end",                 returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listActive",          returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure",           returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushToStartToken", returnType: CAPPluginReturnPromise),
    ]

    // Stored in UserDefaults rather than memory: a background wake starts a
    // fresh process, and these have to be there when it does.
    private static let endpointKey   = "aloto_la_token_endpoint"
    private static let apiKeyKey     = "aloto_la_api_key"
    private static let startTokenKey = "aloto_la_start_token"

    /// Activities whose token is already being watched, so each is watched once
    /// however it was found (started here, found at launch, or announced).
    private let watchLock = NSLock()
    private var watched = Set<String>()

    /// Runs when the plugin loads, which is at app launch — including a
    /// background launch after the server has started an activity.
    override public func load() {
        guard #available(iOS 16.2, *) else { return }

        // Anything already running (started by the server while the app was
        // closed, or left from an earlier session).
        for activity in Activity<GameweekActivityAttributes>.activities {
            watch(activity)
        }

        // Anything started from now on, by the app or the server.
        Task { [weak self] in
            for await activity in Activity<GameweekActivityAttributes>.activityUpdates {
                self?.watch(activity)
            }
        }

        // The push-to-start token. Kept in UserDefaults so the web app can ask
        // for it at any time, and announced as an event that is held until the
        // web app is listening (it usually isn't yet, this early in launch).
        if #available(iOS 17.2, *) {
            Task { [weak self] in
                for await data in Activity<GameweekActivityAttributes>.pushToStartTokenUpdates {
                    let token = LiveActivityPlugin.hex(data)
                    UserDefaults.standard.set(token, forKey: LiveActivityPlugin.startTokenKey)
                    self?.notifyListeners("pushToStartTokenReceived", data: ["token": token], retainUntilConsumed: true)
                }
            }
        }
    }

    /// Live Activities need iOS 16.1, and the user can switch them off per app.
    /// Both are reported so the web side can explain which it is rather than
    /// failing silently.
    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            call.resolve([
                "supported": true,
                "enabled": ActivityAuthorizationInfo().areActivitiesEnabled,
            ])
        } else {
            call.resolve(["supported": false, "enabled": false])
        }
    }

    /// Where to send the update token of a server-started activity, and the key
    /// to send with it. Called by the web app once the user is signed in.
    @objc func configure(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        if let endpoint = call.getString("endpoint") { defaults.set(endpoint, forKey: Self.endpointKey) }
        if let apiKey = call.getString("apiKey") { defaults.set(apiKey, forKey: Self.apiKeyKey) }
        call.resolve()
    }

    /// The latest push-to-start token, or "" if iOS hasn't issued one (older
    /// than 17.2, or Live Activities switched off).
    @objc func getPushToStartToken(_ call: CAPPluginCall) {
        call.resolve(["token": UserDefaults.standard.string(forKey: Self.startTokenKey) ?? ""])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities need iOS 16.1 or later")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // A specific reason, so the app can point at Settings rather than
            // saying something went wrong.
            call.reject("Live Activities are switched off for ALOTO in Settings")
            return
        }

        let attrs = GameweekActivityAttributes(
            competitionName: call.getString("competitionName") ?? "",
            gameweekLabel:   call.getString("gameweekLabel") ?? "",
            myName:          call.getString("myName") ?? "",
            myKit:           call.getString("myKit"),
            opponentName:    call.getString("opponentName"),
            opponentKit:     call.getString("opponentKit"),
            roundLabel:      call.getString("roundLabel"),
            ref:             nil
        )

        let state = GameweekActivityAttributes.ContentState(
            myPoints:       call.getInt("myPoints") ?? 0,
            opponentPoints: call.getInt("opponentPoints"),
            position:       call.getInt("position"),
            playerCount:    call.getInt("playerCount"),
            matchesInPlay:  call.getInt("matchesInPlay") ?? 0,
            statusLine:     call.getString("statusLine") ?? ""
        )

        do {
            let activity = try Activity.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil),
                // .token asks iOS for a push token so the server can update
                // this activity later. Without it the activity can only ever
                // be updated from inside the running app.
                pushType: .token
            )

            // The token arrives asynchronously, and can be reissued during the
            // activity's life — so it is watched rather than read once.
            if #available(iOS 16.2, *) { watch(activity) }

            call.resolve(["activityId": activity.id])
        } catch {
            call.reject("Could not start the Live Activity: \(error.localizedDescription)")
        }
    }

    /// Updates from inside the app. The server updates the same activity by
    /// push; this is for the case where the app is open and has fresher data
    /// than the last push delivered.
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.reject("Needs iOS 16.1"); return }
        guard let id = call.getString("activityId") else {
            call.reject("activityId is required")
            return
        }

        let state = GameweekActivityAttributes.ContentState(
            myPoints:       call.getInt("myPoints") ?? 0,
            opponentPoints: call.getInt("opponentPoints"),
            position:       call.getInt("position"),
            playerCount:    call.getInt("playerCount"),
            matchesInPlay:  call.getInt("matchesInPlay") ?? 0,
            statusLine:     call.getString("statusLine") ?? ""
        )

        Task {
            for activity in Activity<GameweekActivityAttributes>.activities where activity.id == id {
                await activity.update(.init(state: state, staleDate: nil))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.reject("Needs iOS 16.1"); return }
        let id = call.getString("activityId")

        Task {
            for activity in Activity<GameweekActivityAttributes>.activities {
                if id == nil || activity.id == id {
                    // .immediate, not .after — a finished gameweek should not
                    // linger on the lock screen for four hours showing a score
                    // that can no longer change.
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            call.resolve()
        }
    }

    /// What is currently running. Used on launch to avoid starting a second
    /// activity for a gameweek that already has one.
    @objc func listActive(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(["activities": []]); return }

        let ids = Activity<GameweekActivityAttributes>.activities.map { activity in
            ["activityId": activity.id, "gameweekLabel": activity.attributes.gameweekLabel]
        }
        call.resolve(["activities": ids])
    }

    /* ------------------------------------------------------------------ */

    /// Follows one activity's update token for as long as it lives.
    ///
    /// Server-started activities (they carry a ref) post the token straight to
    /// the server. App-started ones hand it to the web app, as before. Never
    /// both: the web app saving a server-started activity would create a second
    /// record for it.
    @available(iOS 16.2, *)
    private func watch(_ activity: Activity<GameweekActivityAttributes>) {
        watchLock.lock()
        let isNew = watched.insert(activity.id).inserted
        watchLock.unlock()
        guard isNew else { return }

        Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                let token = LiveActivityPlugin.hex(data)
                if let ref = activity.attributes.ref, !ref.isEmpty {
                    LiveActivityPlugin.sendToken(ref: ref, activityId: activity.id, token: token)
                } else {
                    self?.notifyListeners("pushTokenReceived", data: [
                        "activityId": activity.id,
                        "token": token,
                    ])
                }
            }
        }
    }

    /// Posts a server-started activity's update token to live-activity-token.
    ///
    /// Wrapped in a background task: when the server starts an activity, iOS
    /// wakes the app for only a few seconds, and the request must finish
    /// inside them.
    private static func sendToken(ref: String, activityId: String, token: String) {
        let defaults = UserDefaults.standard
        guard let endpoint = defaults.string(forKey: endpointKey),
              let url = URL(string: endpoint) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let key = defaults.string(forKey: apiKeyKey) {
            request.setValue(key, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "ref": ref,
            "activityId": activityId,
            "token": token,
        ])

        DispatchQueue.main.async {
            var taskId: UIBackgroundTaskIdentifier = .invalid
            taskId = UIApplication.shared.beginBackgroundTask(withName: "LiveActivityToken") {
                UIApplication.shared.endBackgroundTask(taskId)
                taskId = .invalid
            }
            URLSession.shared.dataTask(with: request) { _, _, _ in
                DispatchQueue.main.async {
                    if taskId != .invalid {
                        UIApplication.shared.endBackgroundTask(taskId)
                        taskId = .invalid
                    }
                }
            }.resume()
        }
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
