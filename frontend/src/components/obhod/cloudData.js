// Keep rejection reasons together with the geometry through the UI adapter.
export function cloudViewData(c) {
  return {
    points: c.points,
    cameras: c.cameras || null,
    pile: c.pile || null,
    surface: c.surface || null,
    geometry_warning: c.geometry_warning || null,
    estimation_warning: c.estimation_warning || null,
  }
}
