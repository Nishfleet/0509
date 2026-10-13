UPDATE entity
SET identity_json = json_remove(identity_json, '$.socialsReadAt')
WHERE role = 'competitor'
  AND state = 'on'
  AND json_valid(identity_json)
  AND json_extract(identity_json, '$.socialsReadAt') IS NOT NULL
  AND coalesce(json_type(identity_json, '$.socials'), 'array') = 'array'
  AND coalesce(json_array_length(identity_json, '$.socials'), 0) = 0;
