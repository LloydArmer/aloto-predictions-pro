//
//  ALOTOWidgetLiveActivity.swift
//  ALOTOWidget
//
//  Created by Brittany Earith on 11/09/2026.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct ALOTOWidgetAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct ALOTOWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ALOTOWidgetAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension ALOTOWidgetAttributes {
    fileprivate static var preview: ALOTOWidgetAttributes {
        ALOTOWidgetAttributes(name: "World")
    }
}

extension ALOTOWidgetAttributes.ContentState {
    fileprivate static var smiley: ALOTOWidgetAttributes.ContentState {
        ALOTOWidgetAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: ALOTOWidgetAttributes.ContentState {
         ALOTOWidgetAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: ALOTOWidgetAttributes.preview) {
   ALOTOWidgetLiveActivity()
} contentStates: {
    ALOTOWidgetAttributes.ContentState.smiley
    ALOTOWidgetAttributes.ContentState.starEyes
}
