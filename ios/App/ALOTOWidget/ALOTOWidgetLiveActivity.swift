//
//  ALOTOWidgetLiveActivity.swift
//  ALOTOWidget
//
//  The gameweek Live Activity: your provisional score on the lock screen and in
//  the Dynamic Island, updating as goals go in.
//
//  Replaces the placeholder Xcode generated. Apple requires all four
//  presentations — lock screen, and the Dynamic Island's expanded, compact and
//  minimal states — so all four are here even though the small ones show little.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct ALOTOWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameweekActivityAttributes.self) { context in

            // ---- Lock screen and notification banner ----
            LockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(Color.white)

        } dynamicIsland: { context in
            DynamicIsland {

                // ---- Expanded: long-pressed ----
                DynamicIslandExpandedRegion(.leading) {
                    SideView(
                        kit: context.attributes.myKit,
                        name: context.attributes.myName,
                        points: context.state.myPoints,
                        highlight: true
                    )
                }

                DynamicIslandExpandedRegion(.trailing) {
                    if let oppName = context.attributes.opponentName,
                       let oppPts = context.state.opponentPoints {
                        SideView(
                            kit: context.attributes.opponentKit,
                            name: oppName,
                            points: oppPts,
                            highlight: false
                        )
                    } else if let pos = context.state.position, let total = context.state.playerCount {
                        // No cup tie this week, so position stands in. A lone
                        // score with nothing to compare it against tells you
                        // very little.
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(ordinal(pos))")
                                .font(.system(size: 20, weight: .bold))
                            Text("of \(total)")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 1) {
                        Text(context.attributes.gameweekLabel)
                            .font(.system(size: 12, weight: .semibold))
                        if let round = context.attributes.roundLabel {
                            Text(round)
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 5) {
                        if context.state.matchesInPlay > 0 {
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 6, height: 6)
                        }
                        Text(context.state.statusLine)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }

            } compactLeading: {
                // Roughly 50 points wide. A kit and a number fit; a name does
                // not, which is the whole reason kits exist.
                HStack(spacing: 3) {
                    PlayerBadge(kit: context.attributes.myKit,
                                name: context.attributes.myName, size: 16)
                    Text("\(context.state.myPoints)")
                        .font(.system(size: 13, weight: .bold))
                }

            } compactTrailing: {
                if let oppPts = context.state.opponentPoints {
                    HStack(spacing: 3) {
                        Text("\(oppPts)")
                            .font(.system(size: 13, weight: .bold))
                        PlayerBadge(kit: context.attributes.opponentKit,
                                    name: context.attributes.opponentName ?? "?", size: 16)
                    }
                } else if let pos = context.state.position {
                    Text(ordinal(pos))
                        .font(.system(size: 13, weight: .bold))
                }

            } minimal: {
                // The smallest state — one glyph. The kit alone, since a number
                // without context means nothing at this size.
                PlayerBadge(kit: context.attributes.myKit,
                            name: context.attributes.myName, size: 18)
            }
            .keylineTint(Color.orange)
        }
    }
}

/// One side of the head to head.
private struct SideView: View {
    let kit: String?
    let name: String
    let points: Int
    let highlight: Bool

    var body: some View {
        VStack(spacing: 3) {
            PlayerBadge(kit: kit, name: name, size: 28)
            Text("\(points)")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(highlight ? .primary : .secondary)
        }
    }
}

/// The lock screen card. Roughly the shape of a fantasy score notification:
/// you one side, your opponent the other, what it is in the middle.
private struct LockScreenView: View {
    let context: ActivityViewContext<GameweekActivityAttributes>

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center) {

                // ---- You ----
                VStack(spacing: 4) {
                    PlayerBadge(kit: context.attributes.myKit,
                                name: context.attributes.myName, size: 34)
                    Text("\(context.state.myPoints)")
                        .font(.system(size: 24, weight: .bold))
                    Text(context.attributes.myName)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)

                // ---- The middle ----
                VStack(spacing: 2) {
                    Text(context.attributes.competitionName)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(context.attributes.gameweekLabel)
                        .font(.system(size: 14, weight: .semibold))
                    if let round = context.attributes.roundLabel {
                        Text(round)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity)

                // ---- Them, or your position ----
                VStack(spacing: 4) {
                    if let oppName = context.attributes.opponentName,
                       let oppPts = context.state.opponentPoints {
                        PlayerBadge(kit: context.attributes.opponentKit,
                                    name: oppName, size: 34)
                        Text("\(oppPts)")
                            .font(.system(size: 24, weight: .bold))
                        Text(oppName)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else if let pos = context.state.position,
                              let total = context.state.playerCount {
                        Text(ordinal(pos))
                            .font(.system(size: 24, weight: .bold))
                        Text("of \(total)")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
            }

            // ---- Status ----
            HStack(spacing: 5) {
                if context.state.matchesInPlay > 0 {
                    Circle().fill(Color.orange).frame(width: 6, height: 6)
                }
                Text(context.state.statusLine)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
    }
}

/// 1st, 2nd, 3rd, 4th. The teens are the exception every naive version gets
/// wrong — 11th, 12th and 13th, not 11st, 12nd and 13rd.
private func ordinal(_ n: Int) -> String {
    let ones = n % 10, tens = n % 100
    if tens >= 11 && tens <= 13 { return "\(n)th" }
    switch ones {
    case 1: return "\(n)st"
    case 2: return "\(n)nd"
    case 3: return "\(n)rd"
    default: return "\(n)th"
    }
}
