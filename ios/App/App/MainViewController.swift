//
//  MainViewController.swift
//  App
//
//  Registers the app's own Capacitor plugins.
//
//  Capacitor used to find plugins written in the app target by scanning the
//  Objective-C runtime. From Capacitor 6 onwards it does not. A plugin can be
//  written correctly, compile cleanly and ship, and still be unreachable from
//  the web side unless it is registered here.
//
//  Nothing warns you. Every call from JavaScript rejects with "not
//  implemented", and our web layer catches those rejections on purpose — a
//  lock screen extra must never break the page that asked for it — so the
//  evidence is swallowed at both ends.
//
//  This is why the lock screen score never worked. LiveActivityPlugin was
//  written, compiled, signed and shipped in three releases, and nothing could
//  call it.
//
//  Any CAPPlugin added to ios/App/App/ must be listed below, or it does not
//  exist as far as the app is concerned.
//

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(ReviewPlugin())
    }
}
