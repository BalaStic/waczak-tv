# Railway runtime research

Issue: [#17 — Researching Railway runtime and public-service requirements](https://github.com/BalaStic/waczak-tv/issues/17)

**Research date:** 2026-11-19  
**Scope:** Current Railway and Railpack documentation only. This report does not inspect or assume changes to the application. No app code or deployment configuration was changed.

## Findings

### Build choices and Node.js startup

Railway's documented zero-configuration builder is **Railpack**, which supports Node.js and detects the language, installs dependencies, and configures build/start commands ([Railway: Railpack](https://docs.railway.com/builds/railpack)). Railpack recognizes a root `package.json`; it chooses the `start` script before `main` or a root `index.js`/`index.ts`, so an `npm start` script is the normal automatic startup path ([Railpack: Node.js](https://railpack.com/languages/node)). Build and start overrides are available in service settings ([Railway: Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)).

A **Dockerfile** is the other documented build route: Railway automatically uses a root file named `Dockerfile` (capital D); its start command then defaults to the Dockerfile `ENTRYPOINT`/`CMD` ([Railway: Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)). This allows installing system packages in the final runtime image, but requires maintaining the image instructions.

Railpack's Node version precedence includes `engines.node` in `package.json`, after `RAILPACK_NODE_VERSION` and `devEngines.runtime`; it defaults to `lts` if no version source is set ([Railpack: Node.js](https://railpack.com/languages/node)). The documentation recognizes the `engines.node` field but does not state precisely how a range such as `>=20` resolves to an installed version. If a specific version is required, the documented explicit override is `RAILPACK_NODE_VERSION`.

### Public ingress and listener requirements

Railway services do not receive a public domain automatically. To expose an HTTP service, generate a Railway-provided domain in service Settings → Networking → Public Networking; it targets the detected listening port (or a selected port when multiple are detected) ([Railway: Working with Domains](https://docs.railway.com/networking/domains/working-with-domains)).

Railway's documented listener requirements are host `0.0.0.0` and the port supplied in the injected `PORT` environment variable. The troubleshooting guide identifies a wrong host or port as the most common reason the edge proxy cannot reach an app and returns 502 ([Railway: Application Failed to Respond](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)). Therefore, reading `PORT` is necessary but binding only to `127.0.0.1` does not meet the documented public-ingress host requirement; the app must listen on `0.0.0.0` and `PORT`. The target port configured for the domain must match the port the process listens on.

### Installing `ffprobe`

Railway's linked Railpack documentation supports adding Apt packages separately for build-time and runtime. It explicitly gives `RAILPACK_DEPLOY_APT_PACKAGES="... ffmpeg"` as the way to add `ffmpeg` to the deploy/runtime image while retaining Railpack's generated packages; the equivalent `railpack.json` setting is `deploy.aptPackages` ([Railpack: Installing Additional Packages](https://railpack.com/guides/installing-packages)). Since the dependency needed by this app is `ffprobe`, the documented Railpack approach is to include the runtime `ffmpeg` package, rather than only a build-time package. A Dockerfile build can install `ffmpeg` in its final runtime stage instead ([Railway: Dockerfiles](https://docs.railway.com/builds/dockerfiles)).

Railway's own docs do not name `ffprobe` or explicitly guarantee the executable contents of the `ffmpeg` Apt package. Confirm availability in the deployed runtime (for example, `ffprobe -version`) before relying on it; this is a verification step, not a Railway health-check requirement.

### Health checks

Health checks are optional and deployment-time only: when configured, Railway requests the selected endpoint until it receives any `2xx` response, then activates the new deployment. Railway does not continuously monitor that endpoint after activation ([Railway: Healthchecks](https://docs.railway.com/deployments/healthchecks)). Health-check requests use the injected `PORT`; Railway documents `healthcheck.railway.app` as their hostname, which must be allowed if the app filters hosts.

Because the ticket says there is no dedicated health endpoint, the documented choices are to leave the health-check path unset or configure an existing endpoint that returns `2xx` when the service is ready. A dedicated `/health` endpoint is an example, not a Railway-mandated path. Ensure the process still listens on `PORT`, because a mismatch can cause a health check to return service unavailable ([Railway: Healthchecks](https://docs.railway.com/deployments/healthchecks)).

## Practical conclusion

The documented low-configuration route is Railpack with the app's `npm start` script, the required Node version selected through the recognized package metadata or an explicit Railpack version variable, and the runtime Apt package configured as above. Before public ingress will work, the listener must use `0.0.0.0` and Railway's `PORT`, and the service needs a generated public domain whose target port matches. Configure a health check only if an existing route reliably returns `2xx` during startup; otherwise, leave it unset. No code change is implied or claimed by this research.
