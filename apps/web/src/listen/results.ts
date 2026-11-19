/**
 * Saves a finished session. Locally the dev server writes it into
 * eval/results; anywhere else the browser offers it as a file.
 */
export async function saveResult(result: { sessionId: string }): Promise<{ savedTo: string } | { downloaded: string }> {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (import.meta.env.DEV) {
    try {
      const response = await fetch("/__eval/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      });
      if (response.ok) {
        const { file } = (await response.json()) as { file: string };
        return { savedTo: file };
      }
    } catch {
      // Fall through to a download.
    }
  }
  const name = `listening-${result.sessionId.replace(/[:.]/g, "-")}.json`;
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return { downloaded: name };
}
