export function getInterfaceZoom(): number {
  const zoom = Number.parseFloat(document.documentElement.style.zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function viewportValueToInterface(value: number): number {
  return value / getInterfaceZoom();
}
