//
//  LiveActivityPlugin.swift
//  App
//
//  Lets the web app start, update and end a gameweek Live Activity.
//
//  Goes in ios/App/App/ — the APP target, not the widget. The widget draws the
//  activity; the app owns it.
//
//  The push token matters most here. Each activity gets its own, separate from
//  the device's notification token, and it is what lets the server update the
//  lock screen while the app is closed — which is the entire point. Without it
//  the score would only change while someone had the app open, and they would
//  not need a lock screen widget for that.
//

import Foundation
import Capacitor
import ActivityKit

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listActive",  returnType: CAPPluginReturnPromise),
    ]

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
            roundLabel:      call.getString("roundLabel")
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
            Task {
                for await tokenData in activity.pushTokenUpdates {
                    let token = tokenData.map { String(format: "%02x", $0) }.joined()
                    self.notifyListeners("pushTokenReceived", data: [
                        "activityId": activity.id,
                        "token": token,
                    ])
                }
            }

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
}
