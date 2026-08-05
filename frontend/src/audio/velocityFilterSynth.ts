import * as Tone from "tone";

/**
 * A subtractive voice whose filter opens with how hard the note is struck.
 *
 * Two problems, one fix. The instruments were bare oscillators straight into
 * the output, so every note had exactly the same spectrum and only its loudness
 * changed -- a synth preset with the filter section missing. And Tone triggers
 * the filter envelope without passing velocity through
 * (`this.filterEnvelope.triggerAttack(time)` in MonoSynth), so even with a
 * filter in place a harder-struck note would be louder and never brighter,
 * collapsing the two cues that tell a listener something was played harder into
 * one.
 *
 * Setting the envelope's floor before delegating is enough: each PolySynth
 * voice is its own instance, so the value is per note and does not leak into
 * whatever else is already sounding.
 *
 * The mapping is stated in octaves rather than as a gain factor, because that
 * is the unit brightness is actually heard in: a note at zero velocity starts
 * `VELOCITY_OCTAVES` below where a note at full velocity starts.
 */

/** How far below the configured cutoff a zero-velocity note begins. */
export const VELOCITY_OCTAVES = 2.5;

/**
 * The cutoff a note at this velocity starts from, in Hz.
 *
 * Kept as a plain function rather than a method so the mapping can be checked
 * without an audio context: the class it belongs to cannot even be loaded
 * without one, and a rule that can only be tested through a mock of the thing
 * it is bolted to is a rule nothing really pins down.
 */
export function velocityBaseFrequency(configured: number, velocity: number): number {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(velocity) ? velocity : 1));
  return configured * Math.pow(2, VELOCITY_OCTAVES * (normalized - 1));
}

export class VelocityFilterSynth extends Tone.MonoSynth {
  /**
   * The configured cutoff floor, in Hz.
   *
   * Read once and kept, because the first attack overwrites the property it
   * would otherwise be read from and every later note would then be measured
   * against the previous note instead of against the preset.
   */
  private configuredBase: number | null = null;

  protected _triggerEnvelopeAttack(time: number, velocity = 1): void {
    this.configuredBase ??= this.toFrequency(this.filterEnvelope.baseFrequency);
    this.filterEnvelope.baseFrequency = velocityBaseFrequency(this.configuredBase, velocity);
    super._triggerEnvelopeAttack(time, velocity);
  }
}
