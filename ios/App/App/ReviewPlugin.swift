//
//  ReviewPlugin.swift
//  App
//
//  Asks for an App Store rating using Apple's own sheet, which appears over
//  the app rather than sending anyone to the App Store. People who leave the
//  app to review it mostly don't come back and don't review it either.
//
//  Goes in ios/App/App/ — the APP target, same as LiveActivityPlugin.swift.
//
//  iOS decides whether the sheet actually appears. It allows at most three a
//  year per person and silently ignores the rest, so this can never nag even
//  if the web side asks too often. That also means "asked: true" below means
//  "we asked iOS", never "the person saw it" — there is no way to know, and
//  anything that claimed otherwise would be guessing.
//

import Foundation
import UIKit
import Capacitor
import StoreKit

@objc(ReviewPlugin)
public class ReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReviewPlugin"
    public let jsName = "Review"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        // StoreKit insists on the main thread and on a scene to present over.
        DispatchQueue.main.async {
            let scenes = UIApplication.shared.connectedScenes
            let foreground = scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
            let anyScene = scenes.first as? UIWindowScene

            guard let scene = foreground ?? anyScene else {
                call.resolve(["asked": false])
                return
            }

            SKStoreReviewController.requestReview(in: scene)
            call.resolve(["asked": true])
        }
    }
}
