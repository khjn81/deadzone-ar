// Artifact capture must not wait for an animated container to become actionable.
// The journey assertions verify each visible phase before this snapshot.
export async function captureApp(page, info, name) {
  const clip = await page.locator("#gameApp").boundingBox();
  if (!clip)
    throw new Error("The application has no visible screenshot bounds");
  await page.screenshot({
    path: info.outputPath(name),
    clip,
    animations: "disabled",
  });
}
