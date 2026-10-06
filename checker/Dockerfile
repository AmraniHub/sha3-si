FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /checker .

# distroless/static includes CA certificates (needed to validate site certificates)
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /checker /checker
USER nonroot
ENTRYPOINT ["/checker"]
