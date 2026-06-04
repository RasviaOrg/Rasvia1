-- Grant manage_tableside_qr to owner roles (Team & Roles checkbox + settings tab).

INSERT INTO role_permissions (role_id, permission)
SELECT rr.id, 'manage_tableside_qr'
FROM restaurant_roles rr
WHERE rr.is_owner = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = rr.id AND rp.permission = 'manage_tableside_qr'
  );
