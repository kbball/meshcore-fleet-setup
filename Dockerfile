# syntax=docker/dockerfile:1

# The frontend is plain files, so it is built once on the build machine whatever the target.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY VERSION ./VERSION
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Go cross-compiles, so the target architecture needs no emulation.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/embed.go
COPY --from=web /app/web/dist ./web/dist
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/fleetsetup ./cmd/fleetsetup
# The image has no shell, so the (empty) firmware mount point is made here and handed to the non-root user.
RUN mkdir -p /out/firmware

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/fleetsetup /fleetsetup
# No firmware inside the image: it is a separate release (see the go-box's `make firmware`), mounted at /firmware.
COPY --from=build --chown=nonroot:nonroot /out/firmware /firmware
ENV FLEET_ADDR=:8080 FLEET_FIRMWARE_DIR=/firmware
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["/fleetsetup", "healthcheck"]
ENTRYPOINT ["/fleetsetup"]
CMD ["serve"]
