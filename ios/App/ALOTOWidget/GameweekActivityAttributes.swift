//
//  GameweekActivityAttributes.swift
//  ALOTO Prediction Pro
//
//  What a Live Activity holds while a gameweek is being played.
//
//  IMPORTANT: this file must belong to BOTH targets — the app and ALOTOWidget.
//  The app starts and updates the activity; the widget draws it. If only one
//  has the file, the other cannot see the type and the build fails with
//  "cannot find 'GameweekActivityAttributes' in scope".
//
//  To check in Xcode: select this file, open the File Inspector on the right,
//  and under Target Membership tick both "App" and "ALOTOWidgetExtension".
//

import Foundation
import ActivityKit

struct GameweekActivityAttributes: ActivityAttributes {

    /// Everything that changes while the activity is running.
    ///
    /// Kept deliberately small: each update is delivered by push, and a large
    /// payload is slower and more likely to be dropped. Only what is actually
    /// drawn is here — no fixture lists, no history.
    public struct ContentState: Codable, Hashable {
        /// The player's provisional points so far this gameweek.
        var myPoints: Int

        /// The opponent's, when there is a cup tie or group fixture this week.
        /// Nil means no head-to-head, and the activity shows league position
        /// instead — which is the common case in a plain league.
        var opponentPoints: Int?

        /// Position in the league, and the size of it. Shown when there is no
        /// opponent to show.
        var position: Int?
        var playerCount: Int?

        /// How many matches are still being played. Zero means everything has
        /// finished and the figures are final apart from the admin confirming.
        var matchesInPlay: Int

        /// A short line describing what is happening — "3 matches in play",
        /// "Full time". Composed on the server so the wording can change
        /// without shipping a new build.
        var statusLine: String
    }

    // ---- Fixed for the life of the activity ----

    /// "ALOTO Predictions League"
    var competitionName: String

    /// "GW4"
    var gameweekLabel: String

    /// The player's name and kit.
    var myName: String
    var myKit: String?

    /// The opponent's, when there is one.
    var opponentName: String?
    var opponentKit: String?

    /// What the tie is — "Quarter-final", "Group round 3". Nil for a plain
    /// league gameweek.
    var roundLabel: String?
}
