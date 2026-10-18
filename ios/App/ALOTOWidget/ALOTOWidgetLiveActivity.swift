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
//  On the lock screen it is deliberately OPAQUE and SHORT.
//
//  The system's default material is translucent, which lets the wallpaper
//  through: against a bright photo the names and the round label disappeared
//  and the card read as a smudge. A solid background costs nothing and makes it
//  legible on any wallpaper. The layout is one row rather than three stacked
//  blocks, which roughly halves the height — a lock screen card competes with
//  everything else on the screen, and a tall one is an imposition.
//

import ActivityKit
import WidgetKit
import SwiftUI

/// Near-black with a purple cast, so the card reads as ALOTO's rather than as
/// a generic system notification.
private let cardBackground = Color(.sRGB, red: 0.06, green: 0.05, blue: 0.10, opacity: 1)

private let upColour = Color(.sRGB, red: 0.24, green: 0.80, blue: 0.47, opacity: 1)
private let downColour = Color(.sRGB, red: 0.95, green: 0.33, blue: 0.33, opacity: 1)

struct ALOTOWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameweekActivityAttributes.self) { context in

            // ---- Lock screen and notification banner ----
            LockScreenView(context: context)
                .activityBackgroundTint(cardBackground)
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

/// One side of the head to head. Dynamic Island only — the lock screen has its
/// own, flatter arrangement.
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

/// A kit on a filled disc, so each end of the card has some weight to it
/// rather than a shape floating on the background.
private struct Avatar: View {
    let kit: String?
    let name: String

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.10))
                .frame(width: 36, height: 36)
            PlayerBadge(kit: kit, name: name, size: 26)
        }
    }
}

/// Where you stand, and which way you are going.
///
/// The arrow is the point of it. A bare "2nd of 12" is a fact; "up two places"
/// while a match is on is the thing worth putting on a lock screen.
private struct PositionLine: View {
    let position: Int
    let playerCount: Int?
    let delta: Int?

    var body: some View {
        HStack(spacing: 3) {
            if let d = delta, d != 0 {
                Image(systemName: d > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                    .font(.system(size: 7))
                    .foregroundStyle(d > 0 ? upColour : downColour)
            }
            Text(playerCount.map { "\(ordinal(position)) of \($0)" } ?? ordinal(position))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(delta.map { $0 > 0 ? upColour : $0 < 0 ? downColour : Color.white.opacity(0.55) }
                                 ?? Color.white.opacity(0.55))
                .lineLimit(1)
        }
    }
}

/// The lock screen card.
///
/// One row: you at the left, the competition in the middle, your opponent at
/// the right — or, with no tie this week, your position in their place.
private struct LockScreenView: View {
    let context: ActivityViewContext<GameweekActivityAttributes>

    private var hasOpponent: Bool {
        context.attributes.opponentName != nil && context.state.opponentPoints != nil
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {

            // ---- You ----
            Avatar(kit: context.attributes.myKit, name: context.attributes.myName)

            VStack(alignment: .leading, spacing: 1) {
                Text("\(context.state.myPoints)")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)
                Text(context.attributes.myName)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineLimit(1)
                // Shown alongside the tie as well as instead of it: how you are
                // doing against your opponent and how you are doing in the
                // table are different questions, and both move as goals go in.
                if let pos = context.state.position, hasOpponent {
                    PositionLine(position: pos,
                                 playerCount: context.state.playerCount,
                                 delta: context.state.positionDelta)
                }
            }

            Spacer(minLength: 2)

            // ---- The middle ----
            VStack(spacing: 1) {
                Text(context.attributes.competitionName)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .lineLimit(1)
                Text(context.attributes.gameweekLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                HStack(spacing: 4) {
                    if context.state.matchesInPlay > 0 {
                        Circle().fill(Color.orange).frame(width: 5, height: 5)
                    }
                    Text(context.state.statusLine)
                        .font(.system(size: 9))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .lineLimit(1)
                }
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 2)

            // ---- Them, or your position ----
            if hasOpponent {
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(context.state.opponentPoints ?? 0)")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.white)
                    Text(context.attributes.opponentName ?? "")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .lineLimit(1)
                    if let round = context.attributes.roundLabel {
                        Text(round)
                            .font(.system(size: 9))
                            .foregroundStyle(Color.white.opacity(0.4))
                            .lineLimit(1)
                    }
                }
                Avatar(kit: context.attributes.opponentKit,
                       name: context.attributes.opponentName ?? "?")
            } else if let pos = context.state.position {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(ordinal(pos))
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.white)
                    if let total = context.state.playerCount {
                        Text("of \(total)")
                            .font(.system(size: 10))
                            .foregroundStyle(Color.white.opacity(0.55))
                    }
                    if let d = context.state.positionDelta, d != 0 {
                        // Only the movement here. The position itself is
                        // already the big number above it.
                        HStack(spacing: 3) {
                            Image(systemName: d > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                                .font(.system(size: 7))
                            Text("\(abs(d))")
                                .font(.system(size: 10, weight: .medium))
                        }
                        .foregroundStyle(d > 0 ? upColour : downColour)
                    }
                }
            }
        }
        .padding(.vertical, 10)
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
