export function activeFirstOrder(ownerExpr: string, idExpr = "id", createdExpr = "created_at"): string {
  return `(${idExpr} = (SELECT workspace_id FROM active_workspace WHERE user_id = ${ownerExpr})) DESC, ${createdExpr} ASC`;
}

export function governingWorkspace(idExpr: string): string {
  return `COALESCE(
    (SELECT gp.workspace_id FROM plan gp WHERE gp.workspace_id = ${idExpr}),
    (SELECT gw.parent_workspace_id FROM workspace gw
       JOIN workspace gp ON gp.id = gw.parent_workspace_id AND gp.owner_user_id = gw.owner_user_id
      WHERE gw.id = ${idExpr}),
    ${idExpr}
  )`;
}
