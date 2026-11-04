const router = require('express').Router();
const multer = require('multer');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');
const { badRequest } = require('../utils/errors');
const S = require('../utils/schemas');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { query } = require('../db');
const locations = require('../services/locations');
const routes = require('../services/routes');
const users = require('../services/users');
const { saveImage } = require('../services/storage');

const { z, id } = S;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 1 } });
const versionParam = z.coerce.number().int().min(1);

/* ===== Locations (Admin + Super Admin) ===== */
router.get('/locations', requireAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ status: z.enum(['active', 'inactive']).optional(), q: z.string().max(100).optional() }).parse(req.query);
  res.json({ items: await locations.listAll(q) });
}));
router.get('/locations/nearby', requireAdmin, asyncHandler(async (req, res) => { // "is this already registered?"
  const q = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).parse(req.query);
  res.json({ radiusMeters: config.duplicateRadiusM, items: await locations.findNearby({ query }, q.lat, q.lng) });
}));
router.get('/locations/:id', requireAdmin, asyncHandler(async (req, res) => res.json(await locations.getAny(id.parse(req.params.id)))));
router.post('/locations', requireAdmin, asyncHandler(async (req, res) =>
  res.status(201).json(await locations.create(req.user, S.locationCreate.parse(req.body)))));
router.put('/locations/:id', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await locations.update(req.user, id.parse(req.params.id), S.locationUpdate.parse(req.body)))));
router.post('/locations/:id/deactivate', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await locations.setStatus(req.user, id.parse(req.params.id), S.expected.parse(req.body).expectedVersion, 'inactive'))));
router.post('/locations/:id/reactivate', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await locations.setStatus(req.user, id.parse(req.params.id), S.expected.parse(req.body).expectedVersion, 'active'))));

router.post('/uploads/image', requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('Send the image as multipart field "image"');
  res.status(201).json(await saveImage(req.file.buffer));
}));

/* ===== Location history (Admin view; Super Admin restore) ===== */
router.get('/locations/:id/versions', requireAdmin, asyncHandler(async (req, res) => {
  const p = S.pagination.parse(req.query);
  res.json(await locations.history(id.parse(req.params.id), p.limit, p.offset));
}));
router.get('/locations/:id/versions/compare', requireAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ from: versionParam, to: versionParam }).parse(req.query);
  res.json(await locations.compare(id.parse(req.params.id), q.from, q.to));
}));
router.get('/locations/:id/versions/:n', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await locations.getVersion(id.parse(req.params.id), versionParam.parse(req.params.n)))));
router.post('/locations/:id/restore', requireSuperAdmin, asyncHandler(async (req, res) => {
  const b = S.restore.parse(req.body);
  res.json(await locations.restore(req.user, id.parse(req.params.id), b.versionNumber, b.expectedVersion));
}));

/* ===== Routes ===== */
router.get('/routes', requireAdmin, asyncHandler(async (req, res) => {
  const q = z.object({
    status: z.enum(['draft', 'active', 'inactive']).optional(),
    sourceLocationId: id.optional(), destinationLocationId: id.optional(),
  }).merge(S.pagination).parse(req.query);
  res.json(await routes.listAdmin(q));
}));
router.get('/routes/:id', requireAdmin, asyncHandler(async (req, res) => res.json(await routes.getAdmin(id.parse(req.params.id)))));
router.post('/routes', requireAdmin, asyncHandler(async (req, res) =>
  res.status(201).json(await routes.createDraft(req.user, S.routeCreate.parse(req.body)))));
router.post('/routes/:id/points', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await routes.appendPoints(req.user, id.parse(req.params.id), S.pointsBatch.parse(req.body).points))));
router.put('/routes/:id', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await routes.update(req.user, id.parse(req.params.id), S.routeUpdate.parse(req.body)))));
for (const kind of ['publish', 'deactivate', 'reactivate']) {
  router.post(`/routes/:id/${kind}`, requireAdmin, asyncHandler(async (req, res) =>
    res.json(await routes.changeStatus(req.user, id.parse(req.params.id), S.expected.parse(req.body).expectedVersion, kind))));
}
router.delete('/routes/:id', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await routes.discardDraft(req.user, id.parse(req.params.id))))); // drafts only

router.get('/routes/:id/versions', requireAdmin, asyncHandler(async (req, res) => {
  const p = S.pagination.parse(req.query);
  res.json(await routes.history(id.parse(req.params.id), p.limit, p.offset));
}));
router.get('/routes/:id/versions/compare', requireAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ from: versionParam, to: versionParam }).parse(req.query);
  res.json(await routes.compare(id.parse(req.params.id), q.from, q.to));
}));
router.get('/routes/:id/versions/:n', requireAdmin, asyncHandler(async (req, res) =>
  res.json(await routes.getVersion(id.parse(req.params.id), versionParam.parse(req.params.n)))));
router.post('/routes/:id/restore', requireSuperAdmin, asyncHandler(async (req, res) => {
  const b = S.restore.parse(req.body);
  res.json(await routes.restore(req.user, id.parse(req.params.id), b.versionNumber, b.expectedVersion));
}));

/* ===== Super Admin only ===== */
router.get('/audit-logs', requireSuperAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ entityType: z.enum(['location', 'route', 'user']).optional(), entityId: id.optional() }).merge(S.pagination).parse(req.query);
  const params = []; const where = [];
  if (q.entityType) { params.push(q.entityType); where.push(`entity_type=$${params.length}`); }
  if (q.entityId) { params.push(q.entityId); where.push(`entity_id=$${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows: c } = await query(`SELECT count(*) AS n FROM audit_logs ${w}`, params);
  params.push(q.limit, q.offset);
  const { rows } = await query(`SELECT log_id, administrator_id, action, entity_type, entity_id, previous_data, new_data, timestamp
    FROM audit_logs ${w} ORDER BY log_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ total: c[0].n, limit: q.limit, offset: q.offset, items: rows.map((r) => ({ logId: r.log_id, administratorId: r.administrator_id,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id, previousData: r.previous_data, newData: r.new_data, timestamp: r.timestamp })) });
}));

router.get('/users', requireSuperAdmin, asyncHandler(async (req, res) => res.json({ items: await users.list() })));
router.post('/users', requireSuperAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ name: S.name.max(120), email: S.email, role: z.enum(['admin', 'super_admin']).default('admin'),
    temporaryPassword: S.password.optional() }).strict().parse(req.body);
  res.status(201).json(await users.create(req.user, b));
}));
router.patch('/users/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ name: S.name.max(120).optional(), role: z.enum(['admin', 'super_admin']).optional(),
    accountStatus: z.enum(['active', 'inactive']).optional() }).strict().refine((o) => Object.keys(o).length, 'Nothing to update').parse(req.body);
  res.json(await users.update(req.user, id.parse(req.params.id), b));
}));

module.exports = router;
