import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createSpinariumService } from "../spinarium/data/supabase-service.js";

// This suite never connects to Supabase. Adapter requests are controlled test
// responses; the unchanged migration runs in isolated, in-memory PostgreSQL.
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const veilingId = "33333333-3333-4333-8333-333333333333";
const artId = "44444444-4444-4444-8444-444444444444";
const artPath = `${veilingId}/${artId}.png`;
const config = {
  supabaseUrl: "https://spinarium.test",
  supabasePublishableKey: "sb_publishable_test",
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const session = { user: { id: userId } };
let currentToken = "test-user-token";
let currentSession = session;
const auth = {
  getAccessToken: () => currentToken,
  getSession: () => currentSession,
};
const emptyDashboard = () =>
  Object.fromEntries([
    ["schemaVersion", "1"],
    ["mode", "live"],
    [
      "profile",
      {
        id: userId,
        displayName: "Collector",
        memberSince: "2026-10-01T00:00:00Z",
        avatarSrc: null,
      },
    ],
    ...[
      "veilings",
      "series",
      "editions",
      "variants",
      "rarities",
      "physicalCards",
      "ownerships",
      "discoveries",
      "achievements",
      "userAchievements",
      "collections",
      "news",
      "events",
    ].map((field) => [field, []]),
  ]);
const png = new File(
  [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
  "test.png",
  { type: "image/png" },
);
const row = {
  id: veilingId,
  name: "Test definition",
  description: "Test lore",
  character_number: 1,
  rarity: null,
  edition: null,
  status: "draft",
  artwork_path: null,
};
const editorInput = {
  name: row.name,
  description: row.description,
  number: 1,
  status: "draft",
};
const passed = [];
async function test(name, check) {
  await check();
  passed.push(name);
  console.log(`PASS ${name}`);
}
const resets = () => {
  currentToken = "test-user-token";
  currentSession = session;
};

await test("unconfigured and elevated-key services fail closed without requests", async () => {
  let requests = 0;
  const unavailable = createSpinariumService({}, auth, {
    fetchImpl: async () => {
      requests++;
    },
  });
  assert.equal(unavailable.configured, false);
  assert.equal(await unavailable.getAdminAccess(), false);
  await assert.rejects(unavailable.getDashboard(), {
    code: "CONFIGURATION_REQUIRED",
  });
  assert.equal(requests, 0);
  const elevated = `${btoa("{}")}.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
  assert.equal(
    createSpinariumService(
      { ...config, supabasePublishableKey: elevated },
      auth,
    ).configured,
    false,
  );
  assert.equal(
    createSpinariumService(
      { ...config, supabasePublishableKey: "sb_secret_do-not-use" },
      auth,
    ).configured,
    false,
  );
});

await test("real empty projection, read contract, credential transport and no claim/grant/delete API", async () => {
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        "https://spinarium.test/rest/v1/rpc/spinarium_dashboard",
      );
      assert.equal(options.headers.Authorization, `Bearer ${currentToken}`);
      assert.equal(options.headers.apikey, config.supabasePublishableKey);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      return response(emptyDashboard());
    },
  });
  const snapshot = await service.getDashboard();
  assert.equal(snapshot.mode, "live");
  assert.deepEqual(snapshot.ownerships, []);
  assert.deepEqual(snapshot.veilings, []);
  assert.equal(service.getCapabilities().claims, false);
  for (const forbidden of [
    "claim",
    "grantOwnership",
    "deleteVeiling",
    "deleteArtwork",
  ])
    assert.equal(forbidden in service, false);
});

await test("admin authorization rejects non-boolean RPC output, metadata roles and transport failures", async () => {
  for (const value of [false, null, "true", { admin: true }]) {
    const service = createSpinariumService(
      config,
      { ...auth, user_metadata: { role: "admin" } },
      { fetchImpl: async () => response(value) },
    );
    assert.equal(await service.getAdminAccess(), false);
  }
  const service = createSpinariumService(config, auth, {
    fetchImpl: async () =>
      response({ message: "secret backend diagnostic" }, 403),
  });
  assert.equal(await service.getAdminAccess(), false);
  await assert.rejects(service.saveVeiling(editorInput), {
    code: "ACCESS_DENIED",
  });
});

await test("incompatible/broader projections and missing schema never become demo ownership", async () => {
  const broader = emptyDashboard();
  broader.veilings = [
    { id: veilingId, name: "Secret hidden character", artwork: [] },
  ];
  const invalid = createSpinariumService(config, auth, {
    fetchImpl: async () => response(broader),
  });
  await assert.rejects(invalid.getDashboard(), { code: "INVALID_PROJECTION" });
  const missing = createSpinariumService(config, auth, {
    fetchImpl: async () =>
      response({ code: "PGRST202", message: "private raw message" }, 404),
  });
  await assert.rejects(missing.getDashboard(), { code: "SCHEMA_REQUIRED" });
});

await test("owned artwork is signed privately once, and primary paths are not returned to views", async () => {
  const snapshot = emptyDashboard();
  snapshot.ownerships = [{ userId, veilingId }];
  snapshot.veilings = [
    {
      id: veilingId,
      artwork: [
        { role: "color_art", storagePath: artPath },
        { role: "thumbnail", storagePath: artPath },
      ],
    },
  ];
  let signatures = 0;
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url, options) => {
      if (url.includes("/rpc/spinarium_dashboard")) return response(snapshot);
      assert(url.includes("/storage/v1/object/sign/spinarium-artwork/"));
      assert.deepEqual(JSON.parse(options.body), { expiresIn: 300 });
      signatures++;
      return response({
        signedURL: `/object/sign/spinarium-artwork/${artPath}?token=test-signed-value`,
      });
    },
  });
  const loaded = await service.getDashboard();
  assert.equal(signatures, 1);
  assert.match(
    loaded.veilings[0].artwork[0].url,
    /^https:\/\/spinarium\.test\/storage\/v1\/object\/sign\//,
  );
  assert.equal("storagePath" in loaded.veilings[0].artwork[0], false);
});

await test("catalog writes whitelist fields; private image upload validates signature, size and immutable path", async () => {
  const calls = [];
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/rpc/is_spinarium_admin")) return response(true);
      if (url.includes("/storage/v1/object/sign/"))
        return response({
          signedURL: `/object/sign/spinarium-artwork/${artPath}?token=test`,
        });
      if (url.includes("/storage/v1/object/spinarium-artwork/")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-upsert"], "false");
        assert.equal(options.headers["Content-Type"], "image/png");
        assert.equal(options.body, png);
        assert.match(url, new RegExp(`${veilingId}/[0-9a-f-]{36}\\.png$`));
        return response({ Key: "private-test-upload" });
      }
      if (options.method === "PATCH")
        return response([
          { ...row, artwork_path: JSON.parse(options.body).artwork_path },
        ]);
      assert.equal(options.method, "POST");
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), [
        "character_number",
        "description",
        "edition",
        "name",
        "rarity",
        "status",
      ]);
      return response([row]);
    },
  });
  await service.saveVeiling({
    ...editorInput,
    user_id: otherUserId,
    artwork_path: artPath,
  });
  const count = calls.length;
  await assert.rejects(
    service.uploadArtwork({
      veilingId,
      file: new File(["<svg/>"], "bad.png", { type: "image/png" }),
    }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    service.uploadArtwork({
      veilingId,
      file: { type: "image/png", size: 8388609, slice() {} },
    }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(calls.length, count);
  const saved = await service.uploadArtwork({ veilingId, file: png });
  assert(saved.artwork_path.startsWith(`${veilingId}/`));
  assert(calls.every(({ options }) => options.method !== "DELETE"));
});

await test("session switch during admin check prevents catalog writes under the next account", async () => {
  let writes = 0;
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url) => {
      if (url.endsWith("/rpc/is_spinarium_admin")) {
        currentToken = "next-admin-token";
        currentSession = { user: { id: otherUserId } };
        return response(true);
      }
      writes++;
      return response([row]);
    },
  });
  await assert.rejects(service.saveVeiling(editorInput), {
    code: "AUTH_REQUIRED",
  });
  assert.equal(writes, 0);
  resets();
});

await test("logout after uploading prevents follow-on attachment and signing", async () => {
  let patches = 0;
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/rpc/is_spinarium_admin")) return response(true);
      if (url.includes("/storage/v1/object/spinarium-artwork/")) {
        currentToken = null;
        currentSession = null;
        return response({ Key: "retained-unused-test-upload" });
      }
      if (options.method === "PATCH") patches++;
      throw new Error("No follow-on request should be dispatched");
    },
  });
  await assert.rejects(service.uploadArtwork({ veilingId, file: png }), {
    code: "AUTH_REQUIRED",
  });
  assert.equal(patches, 0);
  resets();
});

await test("session change during dashboard response prevents signed artwork requests", async () => {
  let signing = 0;
  const snapshot = emptyDashboard();
  snapshot.ownerships = [{ userId, veilingId }];
  snapshot.veilings = [{ id: veilingId, artwork: [{ storagePath: artPath }] }];
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url) => {
      if (url.includes("/rpc/spinarium_dashboard")) {
        currentToken = null;
        currentSession = null;
        return response(snapshot);
      }
      signing++;
      throw new Error("No signing after logout");
    },
  });
  await assert.rejects(service.getDashboard(), { code: "AUTH_REQUIRED" });
  assert.equal(signing, 0);
  resets();
});

await test("signing failure preserves a committed saved row rather than reporting a failed save", async () => {
  let writes = 0;
  const service = createSpinariumService(config, auth, {
    fetchImpl: async (url) => {
      if (url.endsWith("/rpc/is_spinarium_admin")) return response(true);
      if (url.includes("/storage/v1/object/sign/"))
        return response({ message: "private error" }, 500);
      writes++;
      return response([{ ...row, artwork_path: artPath }]);
    },
  });
  const saved = await service.saveVeiling(editorInput);
  assert.equal(writes, 1);
  assert.equal(saved.id, veilingId);
  assert.equal(saved.artworkUrl, null);
  assert.equal(saved.artworkPreviewUnavailable, true);
});

const modulePath = process.env.SPINARIUM_PGLITE_MODULE;
const { PGlite } = await import(
  modulePath
    ? modulePath.startsWith("/")
      ? pathToFileURL(modulePath).href
      : modulePath
    : "@electric-sql/pglite"
);
const db = new PGlite();
const migration = await readFile(
  new URL("../supabase/spinarium-schema.sql", import.meta.url),
  "utf8",
);
const bootstrap = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create schema storage;
  create table auth.users (
    id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  grant usage on schema auth, storage to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, unique(bucket_id, name));
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

async function assume(role, id = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}

try {
  await db.exec(bootstrap);
  await test("migration refuses an existing application database before making schema changes", async () => {
    await db.exec("create table public.existing_application (id integer);");
    await assert.rejects(db.exec(migration), /new dedicated project/);
    await db.exec("rollback");
    // This is an isolated test fixture, never a real site or hosted project.
    await db.exec("drop table public.existing_application");
  });
  await db.exec(migration);
  await db.query(
    "insert into auth.users (id,email,raw_user_meta_data,created_at) values ($1,$2,$3,$4),($5,$6,$7,$8)",
    [
      userId,
      "owner@test.invalid",
      { display_name: "Actual owner" },
      "2026-10-01T01:02:03Z",
      otherUserId,
      "collector@test.invalid",
      { display_name: "Actual collector", role: "admin", is_admin: true },
      "2026-10-02T04:05:06Z",
    ],
  );
  await db.query(
    "insert into private.spinarium_admins (user_id,note) values ($1,$2)",
    [userId, "Isolated test allowlist"],
  );

  await test("actual SQL NULL and spoofed metadata fail closed; anonymous RPC access is denied", async () => {
    await assume("authenticated");
    assert.equal(
      (await db.query("select public.is_spinarium_admin() as allowed")).rows[0]
        .allowed,
      false,
    );
    await assert.rejects(
      db.query("select public.spinarium_dashboard()"),
      /Authentication is required/,
    );
    await assume("authenticated", otherUserId);
    assert.equal(
      (await db.query("select public.is_spinarium_admin() as allowed")).rows[0]
        .allowed,
      false,
    );
    await assert.rejects(
      db.query("select * from private.spinarium_admins"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("insert into private.spinarium_admins (user_id) values ($1)", [
        otherUserId,
      ]),
      /permission denied/,
    );
    await assume("anon");
    await assert.rejects(
      db.query("select public.is_spinarium_admin()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.spinarium_dashboard()"),
      /permission denied/,
    );
  });

  await test("real signup profiles and new-account dashboard contain genuine dates and zero records", async () => {
    await assume("authenticated", otherUserId);
    const snapshot = (
      await db.query("select public.spinarium_dashboard() as data")
    ).rows[0].data;
    assert.equal(snapshot.profile.id, otherUserId);
    assert.equal(snapshot.profile.displayName, "Actual collector");
    assert.equal(
      new Date(snapshot.profile.memberSince).toISOString(),
      "2026-10-02T04:05:06.000Z",
    );
    assert.equal(snapshot.mode, "live");
    for (const field of [
      "veilings",
      "ownerships",
      "discoveries",
      "userAchievements",
      "collections",
    ])
      assert.deepEqual(snapshot[field], []);
    assert.equal(
      (await db.query("select * from public.spinarium_profiles")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("update public.spinarium_profiles set display_name='Elevated'"),
      /permission denied/,
    );
  });

  let savedId;
  await test("admin can create/edit actual definitions with server IDs; regular collectors cannot enumerate or edit them", async () => {
    await assume("authenticated", userId);
    assert.equal(
      (await db.query("select public.is_spinarium_admin() as allowed")).rows[0]
        .allowed,
      true,
    );
    const inserted = await db.query(
      "insert into public.spinarium_veilings(name,description,character_number,status) values ($1,$2,$3,$4) returning *",
      ["Actual definition", "Approved draft text", 1, "draft"],
    );
    savedId = inserted.rows[0].id;
    assert(savedId);
    await db.query(
      "update public.spinarium_veilings set name='Updated definition',status='active' where id=$1",
      [savedId],
    );
    await assert.rejects(
      db.query(
        "insert into public.spinarium_veilings(id,name) values ($1,$2)",
        [veilingId, "Cannot select system ID"],
      ),
      /permission denied/,
    );
    await assume("authenticated", otherUserId);
    assert.deepEqual(
      (
        await db.query(
          "select id,name,character_number from public.spinarium_veilings",
        )
      ).rows,
      [],
    );
    await assert.rejects(
      db.query(
        "insert into public.spinarium_veilings(name) values ('Unauthorized')",
      ),
      /row-level security/,
    );
    assert.deepEqual(
      (
        await db.query(
          "update public.spinarium_veilings set name=$1 where id=$2 returning id",
          ["Tampered", savedId],
        )
      ).rows,
      [],
    );
  });

  let actualPath;
  await test("actual private Storage policies allow admin insertion and deny unowned reads/overwrites/deletion", async () => {
    actualPath = `${savedId}/${artId}.png`;
    await assume("authenticated", userId);
    await db.query(
      "insert into storage.objects(bucket_id,name) values ($1,$2)",
      ["spinarium-artwork", actualPath],
    );
    await db.query(
      "update public.spinarium_veilings set artwork_path=$1 where id=$2",
      [actualPath, savedId],
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values ($1,$2)", [
        "spinarium-artwork",
        `${veilingId}/${artId}.png`,
      ]),
      /row-level security/,
    );
    assert.deepEqual(
      (
        await db.query(
          "update storage.objects set name='overwrite' returning id",
        )
      ).rows,
      [],
    );
    assert.deepEqual(
      (await db.query("delete from storage.objects returning id")).rows,
      [],
    );
    await assume("authenticated", otherUserId);
    assert.deepEqual(
      (await db.query("select name from storage.objects")).rows,
      [],
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values ($1,$2)", [
        "spinarium-artwork",
        actualPath,
      ]),
      /row-level security/,
    );
    await assume("postgres");
    const bucket = (
      await db.query(
        "select * from storage.buckets where id='spinarium-artwork'",
      )
    ).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 8388608);
    assert.deepEqual(bucket.allowed_mime_types, [
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
  });

  await test("ownership browser grants are denied even to admins; private audit is immutable and actor-authored", async () => {
    for (const id of [userId, otherUserId]) {
      await assume("authenticated", id);
      await assert.rejects(
        db.query(
          "insert into public.spinarium_ownerships(user_id,veiling_id,acquisition) values ($1,$2,$3)",
          [id, savedId, "server_grant"],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query("update public.spinarium_ownerships set user_id=$1", [id]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from public.spinarium_ownerships"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from private.spinarium_audit"),
        /permission denied/,
      );
    }
    await assume("postgres");
    const audit = (
      await db.query("select * from private.spinarium_audit order by id")
    ).rows;
    assert(audit.length >= 3);
    assert(audit.every((event) => event.actor_user_id === userId));
    assert(
      audit.some((event) => event.changed_fields.includes("artwork_path")),
    );
    assert.equal(JSON.stringify(audit).includes("Approved draft text"), false);
    await assert.rejects(
      db.query("update private.spinarium_audit set action='INSERT'"),
      /immutable/,
    );
    await assert.rejects(
      db.query("delete from private.spinarium_audit"),
      /immutable/,
    );
  });

  await test("server-granted fixture projects only owned definitions/art/discovery; cross-account and hidden catalog stay absent", async () => {
    await assume("postgres");
    await db.query(
      "insert into public.spinarium_ownerships(user_id,veiling_id,acquisition) values ($1,$2,$3)",
      [otherUserId, savedId, "server_grant"],
    );
    await db.query(
      "insert into public.spinarium_discoveries(veiling_id,first_discovered_at,first_discoverer_user_id,reveal_kind) values ($1,$2,$3,$4)",
      [savedId, "2026-10-02T05:00:00Z", otherUserId, "collector"],
    );
    await db.query(
      "insert into public.spinarium_veilings(name,description,character_number) values ($1,$2,$3)",
      ["Unpublished Secret", "Unowned confidential lore", 914],
    );
    await assume("authenticated", otherUserId);
    const data = (await db.query("select public.spinarium_dashboard() as data"))
      .rows[0].data;
    assert.equal(data.veilings.length, 1);
    assert.equal(data.veilings[0].id, savedId);
    assert.equal(data.ownerships.length, 1);
    assert.equal(data.ownerships[0].userId, otherUserId);
    assert.equal(data.veilings[0].artwork[0].storagePath, actualPath);
    assert.equal(data.discoveries[0].firstDiscovererId, otherUserId);
    assert.equal(JSON.stringify(data).includes("Unpublished Secret"), false);
    assert.equal(JSON.stringify(data).includes("914"), false);
    assert.deepEqual(
      (await db.query("select name from storage.objects")).rows.map(
        (object) => object.name,
      ),
      [actualPath],
    );
    assert.equal(
      (await db.query("select * from public.spinarium_veilings")).rows.length,
      1,
    );
    await assume("authenticated", userId);
    const ownerDashboard = (
      await db.query("select public.spinarium_dashboard() as data")
    ).rows[0].data;
    assert.deepEqual(ownerDashboard.ownerships, []);
    assert.deepEqual(ownerDashboard.veilings, []);
    assert.deepEqual(
      (await db.query("select * from public.spinarium_ownerships")).rows,
      [],
    );
  });
} finally {
  await db.close();
}

console.log(
  `PASS ${passed.length} isolated Spinarium backend checks; no hosted database was contacted`,
);
