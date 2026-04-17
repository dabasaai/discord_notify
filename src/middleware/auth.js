export function apiKeyAuth(expectedKey) {
  if (!expectedKey) {
    throw new Error('API_KEY must be set');
  }
  return (req, res, next) => {
    const got = req.header('x-api-key');
    if (!got || got !== expectedKey) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}
