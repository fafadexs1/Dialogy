-- The team's selected role is the source of truth for its members.
WITH selected_team_role AS (
    SELECT DISTINCT ON (tm.user_id, t.workspace_id)
        tm.user_id,
        t.workspace_id,
        t.role_id
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    ORDER BY tm.user_id, t.workspace_id, t.name
)
UPDATE user_workspace_roles uwr
SET role_id = selected_team_role.role_id
FROM selected_team_role
WHERE uwr.user_id = selected_team_role.user_id
  AND uwr.workspace_id = selected_team_role.workspace_id
  AND uwr.user_id <> (
      SELECT owner_id
      FROM workspaces
      WHERE id = selected_team_role.workspace_id
  );

-- Team-based automatic tags are configured on teams.tag_id. The old CRM-side
-- team restriction is intentionally retired.
UPDATE tags
SET team_ids = ARRAY[]::uuid[]
WHERE COALESCE(cardinality(team_ids), 0) > 0;
