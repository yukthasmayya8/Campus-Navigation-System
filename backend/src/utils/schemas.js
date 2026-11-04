const { z } = require('zod');
const config = require('../config');

const lat = z.number({ invalid_type_error: 'latitude must be a number' }).finite().min(-90).max(90);
const lng = z.number({ invalid_type_error: 'longitude must be a number' }).finite().min(-180).max(180);
const id = z.coerce.number().int().positive();
const version = z.number().int().min(1);
const name = z.string().trim().min(1).max(150);
const triBool = z.boolean().nullable(); // true / false / null (= not verified)
const imageUrl = z.string().trim().max(1000)
  .refine((u) => /^https:\/\//i.test(u) || u.startsWith('/uploads/') || u.startsWith(config.publicBaseUrl + '/uploads/'),
    'imageUrl must be an https URL or a path returned by the upload endpoint').nullable();

const pointSchema = z.object({
  sequenceNumber: z.number().int().min(1).optional(),
  latitude: lat, longitude: lng,
  accuracy: z.number().finite().min(0).max(100000).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const L = config.limits;
const waypointIds = z.array(id).max(L.maxWaypoints)
  .refine((a) => new Set(a).size === a.length, 'A location can appear only once as a waypoint');

const locationCreate = z.object({
  name, description: z.string().trim().max(4000).default(''),
  latitude: lat, longitude: lng, imageUrl: imageUrl.optional(),
  confirmNearby: z.boolean().optional(), // admin acknowledges the nearby-duplicate warning
}).strict();

const locationUpdate = z.object({
  expectedVersion: version,
  name: name.optional(), description: z.string().trim().max(4000).optional(),
  latitude: lat.optional(), longitude: lng.optional(), imageUrl: imageUrl.optional(),
  confirmNearby: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).some((k) => !['expectedVersion', 'confirmNearby'].includes(k)), 'Nothing to update');

const expected = z.object({ expectedVersion: version }).strict();
const restore = z.object({ versionNumber: version, expectedVersion: version }).strict();

const routeFields = {
  sourceLocationId: id, destinationLocationId: id, routeName: name,
  directionality: z.enum(['one_way', 'bidirectional']),
  hasStairs: triBool.default(null), hasRamp: triBool.default(null), isCovered: triBool.default(null),
  notes: z.string().trim().max(2000).nullable().optional(),
};
const routeCreate = z.object({
  ...routeFields,
  points: z.array(pointSchema).max(L.maxPointsPerRoute).default([]),
  waypointLocationIds: waypointIds.default([]),
}).strict().refine((o) => o.sourceLocationId !== o.destinationLocationId, { message: 'Source and destination must differ', path: ['destinationLocationId'] });

const routeUpdate = z.object({
  expectedVersion: version,
  sourceLocationId: id.optional(), destinationLocationId: id.optional(), routeName: name.optional(),
  directionality: z.enum(['one_way', 'bidirectional']).optional(),
  hasStairs: triBool.optional(), hasRamp: triBool.optional(), isCovered: triBool.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  points: z.array(pointSchema).max(L.maxPointsPerRoute).optional(),
  waypointLocationIds: waypointIds.optional(),
}).strict();

const pointsBatch = z.object({ points: z.array(pointSchema).min(1).max(L.maxPointsPerBatch) }).strict();

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});

const password = z.string().min(10, 'Password must be at least 10 characters').max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password needs upper-case, lower-case and a digit');

const email = z.string().trim().toLowerCase().email().max(254);

module.exports = {
  z, id, locationCreate, locationUpdate, expected, restore, routeCreate, routeUpdate, pointsBatch,
  pagination, password, email, name,
};
