const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/errors');
const { z, id } = require('../utils/schemas');
const locations = require('../services/locations');
const routes = require('../services/routes');

router.get('/locations', asyncHandler(async (req, res) => res.json({ items: await locations.listActive() })));

router.get('/locations/search', asyncHandler(async (req, res) => {
  const { q, limit } = z.object({ q: z.string().max(100).default(''), limit: z.coerce.number().int().min(1).max(25).default(10) }).parse(req.query);
  res.json({ items: await locations.searchActive(q, limit) });
}));

router.get('/locations/nearest', asyncHandler(async (req, res) => {
  const q = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180),
    limit: z.coerce.number().int().min(1).max(10).default(3) }).safeParse(req.query);
  if (!q.success) throw badRequest('Query parameters "lat" and "lng" must be valid coordinates');
  res.json({ items: await locations.nearestActive(q.data.lat, q.data.lng, q.data.limit) });
}));

router.get('/locations/:id', asyncHandler(async (req, res) => res.json(await locations.getActive(id.parse(req.params.id)))));

// GET /api/routes?from=<startId>&to=<destId>  -> eligible recorded alternatives (empty list if none)
router.get('/routes', asyncHandler(async (req, res) => {
  const q = z.object({ from: id, to: id }).safeParse(req.query);
  if (!q.success) throw badRequest('Query parameters "from" and "to" must be location IDs');
  const items = await routes.alternatives(q.data.from, q.data.to);
  res.json({ items, message: items.length ? undefined : 'No verified route is currently available between these locations.' });
}));

// One-shot download for the offline cache: all active locations + all eligible routes with full geometry.
router.get('/offline/snapshot', asyncHandler(async (req, res) => {
  const [locs, rts] = await Promise.all([locations.listActive(), routes.publishedForOffline()]);
  res.json({ generatedAt: new Date().toISOString(), locations: locs, routes: rts });
}));

module.exports = router;
