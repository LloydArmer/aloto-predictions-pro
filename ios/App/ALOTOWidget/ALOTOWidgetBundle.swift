//
//  ALOTOWidgetBundle.swift
//  ALOTOWidget
//
//  The widget bundle declares what this extension provides.
//
//  Only the Live Activity. Xcode generated two samples alongside it — a home
//  screen timer widget and a Control Center toggle — and both are removed:
//  the sample widget is placeholder content a reviewer would rightly flag, and
//  the control requires iOS 18 while this app targets 16.1.
//
//  A bundle containing only a Live Activity is perfectly valid. Home screen
//  widgets can be added later if they earn their place.
//

import WidgetKit
import SwiftUI

@main
struct ALOTOWidgetBundle: WidgetBundle {
    var body: some Widget {
        ALOTOWidgetLiveActivity()
    }
}
