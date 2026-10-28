export const LENDING_TIER = "agency";

export function coveredWorkspace(idExpr: string): string {
  return `(SELECT cw.parent_workspace_id IS NULL
      OR EXISTS (SELECT 1 FROM plan cp WHERE cp.workspace_id = cw.id)
      OR EXISTS (
        SELECT 1 FROM workspace cpar
        JOIN plan cpp ON cpp.workspace_id = cpar.id AND cpp.tier = '${LENDING_TIER}'
        WHERE cpar.id = cw.parent_workspace_id AND cpar.owner_user_id = cw.owner_user_id
      )
    FROM workspace cw WHERE cw.id = ${idExpr})`;
}

export function activeFirstOrder(ownerExpr: string, idExpr = "w.id", createdExpr = "w.created_at"): string {
  const active = `(SELECT workspace_id FROM active_workspace WHERE user_id = ${ownerExpr})`;
  return `(COALESCE(${idExpr} = ${active}, 0) AND ${coveredWorkspace(idExpr)}) DESC, ${createdExpr} ASC`;
}

export function governingWorkspace(idExpr: string): string {
  return `COALESCE(
    (SELECT gp.workspace_id FROM plan gp WHERE gp.workspace_id = ${idExpr}),
    (SELECT gw.parent_workspace_id FROM workspace gw
       JOIN workspace gp ON gp.id = gw.parent_workspace_id AND gp.owner_user_id = gw.owner_user_id
       JOIN plan pp ON pp.workspace_id = gp.id AND pp.tier = '${LENDING_TIER}'
      WHERE gw.id = ${idExpr}),
    ${idExpr}
  )`;
}

export function liveWorkspace(idExpr: string): string {
  return `EXISTS (SELECT 1 FROM workspace lw WHERE lw.id = ${idExpr} AND lw.fixture = 0)`;
}
