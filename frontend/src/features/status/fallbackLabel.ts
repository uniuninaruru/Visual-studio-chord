/**
 * Turns a backend fallback reason code into a short phrase for the status bar
 * and diagnostics panel.
 *
 * A fallback is not an error: the work completed, just on a different runtime
 * than requested, so the wording explains the substitution rather than warning.
 */
export function fallbackLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (/oom/i.test(reason)) return "GPU memory limit · batch reduced or CPU fallback";
  if (/unavailable/i.test(reason)) return "Requested runtime unavailable · CPU fallback";
  if (/autoloadfailed/i.test(reason)) return "Accelerated model load failed · safe fallback";
  if (/invalidpreference/i.test(reason)) return "Invalid runtime setting · CPU fallback";
  return "Runtime fallback applied";
}
