// ARGV: 期望不存在, 期望值, 删除, 新值, PX
export const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '1' then
  if current then return 0 end
elseif current ~= ARGV[2] then
  return 0
end
if ARGV[3] == '1' then
  redis.call('DEL', KEYS[1])
elseif ARGV[5] ~= '' then
  redis.call('SET', KEYS[1], ARGV[4], 'PX', tonumber(ARGV[5]))
else
  redis.call('SET', KEYS[1], ARGV[4])
end
return 1
`;
