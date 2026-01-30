#!/bin/bash
set -e

# Use environment variables with defaults
PROXY_HOST="${PROXY_HOST:-__PROXY_HOST__}"
PROXY_PORT="${PROXY_PORT:-__PROXY_PORT__}"
PROXY_ADDR="${PROXY_HOST}:${PROXY_PORT}"

# Find all language servers (there may be multiple versions)
TARGETS=$(find "$HOME/.antigravity-server/bin" -path "*/extensions/antigravity/bin/language_server_linux_*" -type f 2>/dev/null | grep -v ".bak$")
[ -z "$TARGETS" ] && echo "ERROR: language server not found" && exit 1

CONFIGURED_COUNT=0
SKIPPED_COUNT=0

# Process each language server found
while IFS= read -r TARGET; do
    [ -z "$TARGET" ] && continue
    
    echo "Processing: $TARGET"
BAK="${TARGET}.bak"

    # Check if already configured with correct proxy address
if head -1 "$TARGET" 2>/dev/null | grep -q "^#!/bin/bash"; then
    if grep -q "PROXY_ADDR=\"$PROXY_ADDR\"" "$TARGET" 2>/dev/null; then
            echo "  Already configured with $PROXY_ADDR"
            SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            continue
    fi
fi

# Create backup if needed
if [ ! -f "$BAK" ]; then
    if head -1 "$TARGET" 2>/dev/null | grep -q "^#!/bin/bash"; then
            echo "  ERROR: target is script but no backup exists, skipping"
            continue
    fi
    mv "$TARGET" "$BAK"
        echo "  Backup created"
fi

# Create wrapper script - dynamically find mgraftcp at runtime
# This ensures version upgrades don't break existing wrappers
cat > "$TARGET" << 'WRAPPER_EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

# Proxy configuration - can be updated without replacing the wrapper
PROXY_ADDR="__PROXY_ADDR_PLACEHOLDER__"

# Dynamically find mgraftcp binary at runtime
# This handles extension version upgrades automatically
find_mgraftcp() {
    local arch=$(uname -m)
    local binary_name=""
    case "$arch" in
        x86_64|amd64) binary_name="mgraftcp-linux-amd64" ;;
        aarch64|arm64) binary_name="mgraftcp-linux-arm64" ;;
        *) return 1 ;;
    esac
    
    # Search in all antigravity-ssh-proxy extension versions
    for dir in "$HOME/.antigravity-server/extensions/"*antigravity-ssh-proxy*/resources/bin; do
        if [ -f "$dir/$binary_name" ]; then
            echo "$dir/$binary_name"
            return 0
        fi
    done
    return 1
}

MGRAFTCP_PATH=$(find_mgraftcp)
if [ -z "$MGRAFTCP_PATH" ] || [ ! -f "$MGRAFTCP_PATH" ]; then
    # Fallback: run without proxy if mgraftcp not found
    exec "$SCRIPT_DIR/$SCRIPT_NAME.bak" "$@"
fi

chmod +x "$MGRAFTCP_PATH" 2>/dev/null || true
exec "$MGRAFTCP_PATH" --socks5 "$PROXY_ADDR" "$SCRIPT_DIR/$SCRIPT_NAME.bak" "$@"
WRAPPER_EOF

# Replace placeholder with actual proxy address
sed -i "s|__PROXY_ADDR_PLACEHOLDER__|$PROXY_ADDR|g" "$TARGET"

chmod +x "$TARGET"
    echo "  Configured with proxy $PROXY_ADDR"
    CONFIGURED_COUNT=$((CONFIGURED_COUNT + 1))
done <<< "$TARGETS"

if [ $CONFIGURED_COUNT -gt 0 ]; then
    echo "Setup complete: $CONFIGURED_COUNT configured, $SKIPPED_COUNT already configured"
elif [ $SKIPPED_COUNT -gt 0 ]; then
    echo "Already configured with $PROXY_ADDR"
else
    echo "No language servers were configured"
    exit 1
fi
