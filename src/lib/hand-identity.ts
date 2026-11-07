import type { Frame, HandFeature, Side, Vec3 } from "../types";

type Track = { hand: HandFeature; t: number; velocity: Vec3; votes: Side[]; born: number };
const opposite = (side: Side): Side => side === "Left" ? "Right" : "Left";

/** Associate measured detections, never synthesize a missing hand. Handedness
 * initializes a channel; motion continuity keeps it stable through rotation. */
export class HandIdentityTracker {
  private tracks = new Map<Side, Track>();
  private time = -Infinity;
  reset() { this.tracks.clear(); this.time = -Infinity; }
  push(frame: Frame): Frame {
    if (frame.t <= this.time) this.reset();
    this.time = frame.t;
    for (const [side, track] of this.tracks)
      if (frame.t - track.t > 250) this.tracks.delete(side);
    const hands = frame.hands.slice(0, 2);
    if (!hands.length) return { ...frame, hands: [] };
    const cost = (hand: HandFeature, side: Side) => {
      const track = this.tracks.get(side);
      if (!track) return .3 + (hand.side === side ? 0 : .12 * hand.score);
      const dt = Math.min(100, frame.t - track.t) / 1000;
      const distance = Math.hypot(...hand.wrist.map((v, i) => v - track.hand.wrist[i] - track.velocity[i] * dt));
      const curlDifference = Math.sqrt(hand.curls.reduce((sum, value, i) => sum + (value - track.hand.curls[i]) ** 2, 0) / 5);
      return distance + .04 * curlDifference + (hand.side === side ? 0 : .015 * hand.score);
    };
    const alternatives: Side[][] = hands.length === 2 ? [["Left", "Right"], ["Right", "Left"]] : [["Left"], ["Right"]];
    let sides = alternatives.sort((a, b) =>
      a.reduce((sum, side, i) => sum + cost(hands[i], side), 0) -
      b.reduce((sum, side, i) => sum + cost(hands[i], side), 0))[0];
    // Correct an uncertain first SINGLE-hand observation during acquisition,
    // then lock identity. Sustained palm/back rotation must not swap channels.
    if (hands.length === 1 && this.tracks.size === 1) {
      const [side, track] = [...this.tracks][0];
      if (frame.t - track.born < 300 && cost(hands[0], side) < .18) {
        const votes = [...track.votes, hands[0].side].slice(-9);
        const left = votes.filter(v => v === "Left").length;
        const elected = left > votes.length / 2 ? "Left" : left < votes.length / 2 ? "Right" : side;
        if (elected !== side) { this.tracks.delete(side); this.tracks.set(elected, track); }
        track.votes = votes;
        sides = [elected];
      }
    }
    const observed = hands.map((hand, i) => {
      const side = sides[i], track = this.tracks.get(side);
      const dt = track ? (frame.t - track.t) / 1000 : 0;
      const velocity = track && dt > 0 ? hand.wrist.map((v, j) =>
        Math.max(-4, Math.min(4, (v - track.hand.wrist[j]) / dt))) as Vec3 : [0, 0, 0] as Vec3;
      const result = { ...hand, side };
      this.tracks.set(side, { hand: result, t: frame.t, velocity,
        votes: track?.votes ?? [hand.side], born: track?.born ?? frame.t });
      return result;
    });
    // If a single new hand replaces an expired track, its raw label is used by
    // the assignment above; a second same-side detection gets the free channel.
    if (observed.length === 2 && observed[0].side === observed[1].side)
      observed[1].side = opposite(observed[0].side);
    return { ...frame, hands: observed };
  }
}
