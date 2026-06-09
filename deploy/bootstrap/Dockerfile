# deploy/bootstrap/Dockerfile
# One-shot Convex deployer/seeder. Uses the official Bun image (Debian-based:
# ships bash + coreutils) which runs the Convex CLI via `bunx convex`.
FROM oven/bun:1

WORKDIR /app

# Writable mount point for the /convex working copy created at runtime.
RUN mkdir -p /convex

COPY bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
