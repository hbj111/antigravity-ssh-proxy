#!/bin/bash
set -e

# ============================================================================
# Antigravity SSH Proxy - Setup Script
# ============================================================================
# This script creates wrapper scripts for language servers to route their
# traffic through a proxy using mgraftcp-fakedns.
#
# Environment Variables:
#   PROXY_HOST       - Proxy server host (default: __PROXY_HOST__)
#   PROXY_PORT       - Proxy server port (default: __PROXY_PORT__)
#   PROXY_TYPE       - Proxy type: http or socks5 (default: __PROXY_TYPE__)
#   EXTENSION_PATH   - Current extension's exact path (optional)
#   EXTENSION_VERSION - Current extension version for update detection
#   DEBUG            - Set to 1 for verbose output
# ============================================================================

# Use environment variables with defaults
PROXY_HOST="${PROXY_HOST:-__PROXY_HOST__}"
PROXY_PORT="${PROXY_PORT:-__PROXY_PORT__}"
PROXY_TYPE="${PROXY_TYPE:-__PROXY_TYPE__}"
EXTENSION_PATH="${EXTENSION_PATH:-}"
EXTENSION_VERSION="${EXTENSION_VERSION:-unknown}"
PROXY_ADDR="${PROXY_HOST}:${PROXY_PORT}"

# ============================================================================
# Debug Logging
# ============================================================================
DEBUG="${DEBUG:-0}"

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        echo "[DEBUG] $*"
    fi
}

info_log() {
    echo "[INFO] $*"
}

warn_log() {
    echo "[WARN] $*"
}

error_log() {
    echo "[ERROR] $*"
}

# ============================================================================
# Header
# ============================================================================
echo "========================================"
echo "Antigravity SSH Proxy - Setup"
echo "========================================"
echo ""

# System info
ARCH=$(uname -m)
info_log "System Architecture: $ARCH"

# Self-test for necessary system tools
for tool in file ldd bash; do
    if ! command -v $tool &>/dev/null; then
        warn_log "System tool '$tool' is missing. Some architecture detection may fail."
    fi
done

info_log "Proxy Config: $PROXY_ADDR ($PROXY_TYPE)"
info_log "Extension Version: $EXTENSION_VERSION"
if [ -n "$EXTENSION_PATH" ]; then
    info_log "Extension Path: $EXTENSION_PATH"
fi

# Cleanup old version directories to avoid confusion and binary mismatches
# Search and remove versions that are known to have architecture issues on RK3588
info_log "Checking for old version conflicts..."
for old_ver in 0.0.15 0.0.24 0.0.25 0.0.26; do
    if [ "$old_ver" != "$EXTENSION_VERSION" ]; then
        old_dirs=$(ls -d "$HOME/.antigravity-server/extensions/"*antigravity-ssh-proxy-"$old_ver"* 2>/dev/null || true)
        if [ -n "$old_dirs" ]; then
            info_log "Cleaning up old version: $old_ver"
            echo "$old_dirs" | xargs rm -rf 2>/dev/null || true
        fi
    fi
done

echo ""

# Determine expected binary names based on architecture
# RK3588 Special: If system is aarch64 but target is arm (32-bit), we need the 32-bit bridge.
TARGET_ARCH="$ARCH"
TARGET_IS_32BIT=0

# Try to detect Language Server architecture
LS_BIN=$(find "$HOME/.antigravity-server/bin" -name "language_server_linux" | head -n 1 || echo "")
if [ -n "$LS_BIN" ] && [ -f "$LS_BIN" ]; then
    if file "$LS_BIN" | grep -q "32-bit"; then
        info_log "Detected 32-bit Language Server on $ARCH system. Switching to 32-bit bridge mode."
        TARGET_ARCH="arm"
        TARGET_IS_32BIT=1
        
        # Verify if system can run 32-bit
        if [ "$ARCH" = "aarch64" ] && ! dpkg --get-selections | grep -q "libc6:armhf"; then
             warn_log "================================================================"
             warn_log "MISSING 32-bit RUNTIME: libc6:armhf is required for this proxy."
             warn_log "Please run the following command to enable it:"
             warn_log "sudo dpkg --add-architecture armhf && sudo apt update && sudo apt install -y libc6:armhf"
             warn_log "================================================================"
        fi
    fi
fi

case "$TARGET_ARCH" in
    x86_64|amd64) 
        EXPECTED_BINARY="mgraftcp-fakedns-linux-amd64"
        EXPECTED_LIB="libdnsredir-linux-amd64.so"
        ;;
    aarch64|arm64) 
        EXPECTED_BINARY="mgraftcp-fakedns-linux-arm64"
        EXPECTED_LIB="libdnsredir-linux-arm64.so"
        ;;
    armv7l|armv8l|armhf|arm)
        EXPECTED_BINARY="mgraftcp-fakedns-linux-arm"
        EXPECTED_LIB="libdnsredir-linux-arm.so"
        ;;
    *) 
        EXPECTED_BINARY="mgraftcp-fakedns-linux-$TARGET_ARCH"
        EXPECTED_LIB="libdnsredir-linux-$TARGET_ARCH.so"
        ;;
esac

debug_log "Expected Binary: $EXPECTED_BINARY"
debug_log "Expected Library: $EXPECTED_LIB"

# ============================================================================
# Scan for extension directories (for debugging)
# ============================================================================
if [ "$DEBUG" = "1" ]; then
    echo ""
    echo "[SCAN] Searching for extension directories..."
    EXT_DIRS=$(ls -d "$HOME/.antigravity-server/extensions/"*antigravity-ssh-proxy* 2>/dev/null | sort -t'-' -k3 -V -r || echo "")
    if [ -n "$EXT_DIRS" ]; then
        echo "$EXT_DIRS" | while read -r dir; do
            echo "  📦 $dir"
            BIN_DIR="$dir/resources/bin"
            if [ -d "$BIN_DIR" ]; then
                for f in "$BIN_DIR"/*; do
                    [ -e "$f" ] || continue
                    fname=$(basename "$f")
                    if [ -x "$f" ]; then
                        echo "    ├── $fname ✅"
                    else
                        echo "    ├── $fname"
                    fi
                done
            fi
        done
    else
        echo "  ⚠️  No extension directories found!"
    fi
    echo ""
fi

# ============================================================================
# Helper Functions
# ============================================================================

# Extract wrapper version from a wrapper script
get_wrapper_version() {
    local wrapper="$1"
    grep -oP 'WRAPPER_VERSION="\K[^"]+' "$wrapper" 2>/dev/null || echo "none"
}

# Extract proxy address from a wrapper script
get_wrapper_proxy_addr() {
    local wrapper="$1"
    grep -oP 'PROXY_ADDR="\K[^"]+' "$wrapper" 2>/dev/null || echo "none"
}

# Extract proxy type from a wrapper script
get_wrapper_proxy_type() {
    local wrapper="$1"
    grep -oP 'PROXY_TYPE="\K[^"]+' "$wrapper" 2>/dev/null || echo "none"
}

# Check if target is a wrapper script (bash script)
is_wrapper_script() {
    local target="$1"
    head -1 "$target" 2>/dev/null | grep -q "^#!/bin/bash"
}

# Determine if wrapper needs to be updated
# Returns: 0 = needs update (with reason in stdout), 1 = up-to-date
check_needs_update() {
    local target="$1"
    
    # Check 1: Not a wrapper script (original binary) → needs wrapper creation
    if ! is_wrapper_script "$target"; then
        echo "new_install"
        return 0
    fi
    
    # Check 2: Version mismatch → needs update (covers upgrade, downgrade, legacy)
    local wrapper_version=$(get_wrapper_version "$target")
    if [ "$EXTENSION_VERSION" != "$wrapper_version" ]; then
        echo "version:$wrapper_version->$EXTENSION_VERSION"
        return 0
    fi
    
    # Check 3: Proxy address mismatch → needs update
    local wrapper_proxy_addr=$(get_wrapper_proxy_addr "$target")
    if [ "$PROXY_ADDR" != "$wrapper_proxy_addr" ]; then
        echo "proxy_addr:$wrapper_proxy_addr->$PROXY_ADDR"
        return 0
    fi
    
    # Check 4: Proxy type mismatch → needs update
    local wrapper_proxy_type=$(get_wrapper_proxy_type "$target")
    if [ "$PROXY_TYPE" != "$wrapper_proxy_type" ]; then
        echo "proxy_type:$wrapper_proxy_type->$PROXY_TYPE"
        return 0
    fi
    
    # All checks passed → up-to-date
    return 1
}

# ============================================================================
# Find Language Servers
# ============================================================================
echo "[SEARCH] Looking for language servers..."
TARGETS=$(find "$HOME/.antigravity-server/bin" -maxdepth 6 -name "language_server_linux*" -type f 2>/dev/null | grep -v ".bak$")

if [ -z "$TARGETS" ]; then
    info_log "No language servers found yet. This is normal if they are still downloading."
    info_log "Please wait a few moments and try 'Antigravity SSH Proxy: Setup Remote Environment' again."
    exit 0
fi

TARGET_COUNT=$(echo "$TARGETS" | wc -l)
info_log "Found $TARGET_COUNT targets"
echo

# ============================================================================
# Process Each Language Server
# ============================================================================
CONFIGURED_COUNT=0
SKIPPED_COUNT=0

echo "[PROCESS] Configuring language servers..."
echo ""

while IFS= read -r TARGET; do
    [ -z "$TARGET" ] && continue
    
    echo "----------------------------------------"
    echo "Target: $TARGET"
    BAK="${TARGET}.bak"
    
    # Check for architecture mismatch (32-bit LS on 64-bit system)
    TARGET_ELF_ARCH=""
    if command -v file &>/dev/null; then
        TARGET_ELF_ARCH=$(file -b "$TARGET" 2>/dev/null || echo "")
    fi

    if [[ "$TARGET" == *"_arm"* ]] && [[ "$ARCH" == "aarch64" ]]; then
        if [[ "$TARGET_ELF_ARCH" == *"32-bit"* ]]; then
            warn_log "Architecture mismatch: 32-bit Language Server on aarch64 system."
            warn_log "You MUST use 32-bit mgraftcp and libdnsredir for this to work."
            warn_log "I will search for 32-bit binaries linux-arm..."
            
            # Switch expected tools for THIS target
            TARGET_BINARY="mgraftcp-fakedns-linux-arm"
            TARGET_LIB="libdnsredir-linux-arm.so"
        else
             TARGET_BINARY="$EXPECTED_BINARY"
             TARGET_LIB="$EXPECTED_LIB"
        fi
    else
        TARGET_BINARY="$EXPECTED_BINARY"
        TARGET_LIB="$EXPECTED_LIB"
    fi
    
    # Check if update is needed
    if UPDATE_REASON=$(check_needs_update "$TARGET"); then
        info_log "Update needed: $UPDATE_REASON"
        
        # Log current wrapper state for debugging
        if is_wrapper_script "$TARGET"; then
            debug_log "Current wrapper state:"
            debug_log "  Version: $(get_wrapper_version "$TARGET")"
            debug_log "  Proxy: $(get_wrapper_proxy_addr "$TARGET")"
            debug_log "  Type: $(get_wrapper_proxy_type "$TARGET")"
        fi
    else
        # Already up-to-date
        info_log "Already up-to-date v$EXTENSION_VERSION"
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    # Create backup if needed
    if [ ! -f "$BAK" ]; then
        if is_wrapper_script "$TARGET"; then
            error_log "Target is a wrapper script but no backup exists!"
            error_log "Cannot proceed without original binary backup"
            continue
        fi
        mv "$TARGET" "$BAK"
        info_log "Backup created: $BAK"
    else
        debug_log "Backup already exists: $BAK"
    fi

    # ========================================================================
    # Create Wrapper Script
    # ========================================================================
    # The wrapper script dynamically finds mgraftcp-fakedns at runtime,
    # allowing version upgrades without breaking existing wrappers.
    # ========================================================================
cat > "$TARGET" << 'WRAPPER_EOF'
#!/bin/bash
# ============================================================================
# Antigravity SSH Proxy - Language Server Wrapper
# ============================================================================
# WRAPPER_VERSION="__EXTENSION_VERSION_PLACEHOLDER__"
# GENERATED="__TIMESTAMP_PLACEHOLDER__"
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

# Proxy configuration - can be updated without replacing the wrapper
PROXY_ADDR="__PROXY_ADDR_PLACEHOLDER__"
PROXY_TYPE="__PROXY_TYPE_PLACEHOLDER__"
EXTENSION_BIN_PATH="__EXTENSION_BIN_PATH_PLACEHOLDER__"

# Dynamically find mgraftcp-fakedns and libdnsredir at runtime
find_binaries() {
    local target_binary="$1"
    local arch=$(uname -m)
    local binary_name=""
    local lib_name=""
    
    # Check if we should override based on target binary architecture
    # On some ARM64 systems (like RK3588), 64-bit binaries may be named with _arm suffix
    local actual_elf_arch=""
    if command -v file &>/dev/null; then
        actual_elf_arch=$(file -b "$target_binary" 2>/dev/null || echo "")
    fi

    if [[ "$target_binary" == *"_arm"* ]]; then
        if [[ "$actual_elf_arch" == *"aarch64"* ]] || [[ "$actual_elf_arch" == *"ARM aarch64"* ]]; then
            # Misnamed 64-bit binary
            binary_name="mgraftcp-fakedns-linux-arm64"
            lib_name="libdnsredir-linux-arm64.so"
        else
            # Assume 32-bit arm
            binary_name="mgraftcp-fakedns-linux-arm"
            lib_name="libdnsredir-linux-arm.so"
        fi
    elif [[ "$target_binary" == *"_x64"* ]] || [[ "$target_binary" == *"_amd64"* ]]; then
        binary_name="mgraftcp-fakedns-linux-amd64"
        lib_name="libdnsredir-linux-amd64.so"
    else
        # Fallback to system architecture
        case "$arch" in
            x86_64|amd64) 
                binary_name="mgraftcp-fakedns-linux-amd64"
                lib_name="libdnsredir-linux-amd64.so"
                ;;
            aarch64|arm64) 
                binary_name="mgraftcp-fakedns-linux-arm64"
                lib_name="libdnsredir-linux-arm64.so"
                ;;
            armv7l|armv8l|armhf|arm)
                binary_name="mgraftcp-fakedns-linux-arm"
                lib_name="libdnsredir-linux-arm.so"
                ;;
        esac
    fi

    # Final check: If the selected binary_name doesn't exist but we are on aarch64, 
    # and we were looking for 'arm' (32-bit), try 'arm64' as a last resort.
    # This covers cases where 'file' command is missing but it's a misnamed binary.
    if [ "$arch" = "aarch64" ] && [[ "$binary_name" == *"linux-arm" ]]; then
        # We'll check existence in the loop below and potentially swap
        true
    fi
    
    # Method 1: Use exact extension path if provided (preferred)
    if [ -n "$EXTENSION_BIN_PATH" ] && [ -d "$EXTENSION_BIN_PATH" ]; then
        if [ -f "$EXTENSION_BIN_PATH/$binary_name" ]; then
            # Verify bitness
            if [ "$TARGET_IS_32BIT" = "1" ] && file "$EXTENSION_BIN_PATH/$binary_name" | grep -q "64-bit"; then
                debug_log "Found $binary_name but it is 64-bit, skipping (need 32-bit)."
            else
                echo "$EXTENSION_BIN_PATH/$binary_name"
                [ -f "$EXTENSION_BIN_PATH/$lib_name" ] && echo "$EXTENSION_BIN_PATH/$lib_name"
                return 0
            fi
        fi
    fi
    
    # Method 2: Fallback - search in all versions (sorted by version, newest first)
    for dir in $(ls -d "$HOME/.antigravity-server/extensions/"*antigravity-ssh-proxy*/resources/bin 2>/dev/null | sort -t'-' -k3 -V -r); do
        if [ -f "$dir/$binary_name" ]; then
            # Verify bitness
            if [ "$TARGET_IS_32BIT" = "1" ] && file "$dir/$binary_name" | grep -q "64-bit"; then
                debug_log "Found $dir/$binary_name but it is 64-bit, skipping."
            else
                echo "$dir/$binary_name"
                [ -f "$dir/$lib_name" ] && echo "$dir/$lib_name"
                return 0
            fi
        fi
    done
    return 1
}

# Function to build 32-bit graftcp binaries if missing on ARM64
build_32bit_binaries() {
    local target_dir="$1"
    info_log "Attempting to build 32-bit ARM binaries on RK3588/ARM64..."
    
    if ! command -v gcc &>/dev/null || ! command -v make &>/dev/null; then
        warn_log "Build tools (gcc/make) not found. Cannot build 32-bit binaries automatically."
        return 1
    fi

    local temp_build="/tmp/graftcp_build"
    mkdir -p "$temp_build"
    cd "$temp_build" || return 1
    
    info_log "Cloning graftcp source..."
    if ! git clone --depth 1 https://github.com/hmgle/graftcp.git . 2>/dev/null; then
        warn_log "Git clone failed. Internet access might be required."
        return 1
    fi
    
    info_log "Compiling mgraftcp 32-bit..."
    # Try to build 32-bit. On ARM64 Debian/Ubuntu, this often works with -m32 or just using the right toolchain
    if command -v arm-linux-gnueabihf-gcc &>/dev/null; then
        make CROSS_COMPILE=arm-linux-gnueabihf-
    elif gcc -v 2>&1 | grep -q "aarch64"; then
        # On some ARM64 systems, you can build 32-bit if libc6-dev-armhf-cross is installed
        make CROSS_COMPILE=arm-linux-gnueabihf- || make
    else
        make
    fi
    
    if [ -f "local/mgraftcp" ]; then
        cp local/mgraftcp "$target_dir/mgraftcp-fakedns-linux-arm"
        info_log "✅ Successfully built mgraftcp-fakedns-linux-arm"
    fi
    
    # Build libdnsredir.so 32-bit
    cd local/dnsredir || return 1
    local gcc_cmd="gcc"
    [ -n "$(command -v arm-linux-gnueabihf-gcc)" ] && gcc_cmd="arm-linux-gnueabihf-gcc"
    
    $gcc_cmd -Wall -Wextra -O2 -fPIC -o libdnsredir.so dnsredir.c -shared -ldl 2>/dev/null
    if [ -f "libdnsredir.so" ]; then
        cp libdnsredir.so "$target_dir/libdnsredir-linux-arm.so"
        info_log "✅ Successfully built libdnsredir-linux-arm.so"
    fi
    
    cd /tmp && rm -rf "$temp_build"
    return 0
}

# Get both paths
BINARIES=$(find_binaries "$SCRIPT_DIR/$SCRIPT_NAME.bak")
MGRAFTCP_PATH=$(echo "$BINARIES" | head -n 1)
DNSREDIR_PATH=$(echo "$BINARIES" | sed -n '2p')

# If missing 32-bit but on ARM64, try to build
if [ -z "$MGRAFTCP_PATH" ] && [[ "$ARCH" == "aarch64" ]] && [[ "$TARGET_BINARY" == *"linux-arm" ]]; then
    EXTENSION_BIN_DIR="${EXTENSION_PATH:-$HOME/.antigravity-server/extensions/dinobot22.antigravity-ssh-proxy-$EXTENSION_VERSION}/resources/bin"
    mkdir -p "$EXTENSION_BIN_DIR"
    build_32bit_binaries "$EXTENSION_BIN_DIR"
    
    # Re-search
    BINARIES=$(find_binaries "$SCRIPT_DIR/$SCRIPT_NAME.bak")
    MGRAFTCP_PATH=$(echo "$BINARIES" | head -n 1)
    DNSREDIR_PATH=$(echo "$BINARIES" | sed -n '2p')
fi

    if [ -z "$MGRAFTCP_PATH" ] || [ ! -f "$MGRAFTCP_PATH" ]; then
        # Final fallback: use system mgraftcp if available
        SYSTEM_MGRAFTCP=$(which mgraftcp 2>/dev/null || true)
        if [ -n "$SYSTEM_MGRAFTCP" ]; then
            MGRAFTCP_PATH="$SYSTEM_MGRAFTCP"
            info_log "Using system mgraftcp as fallback"
        else
            warn_log "CRITICAL: mgraftcp binary NOT found and build failed."
            exec "$SCRIPT_DIR/$SCRIPT_NAME.bak" "$@"
        fi
    fi

chmod +x "$MGRAFTCP_PATH" 2>/dev/null || true

# Force Go programs to use cgo DNS resolver (required for LD_PRELOAD to work)
export GODEBUG="${GODEBUG:+$GODEBUG,}netdns=cgo"

# Fix for RK3588/ARM64: The mgraftcp binary may have hardcoded libdnsredir-linux-amd64.so
# We override it by providing the correct path via GRAFTCP_INTERNAL_LIB
if [ -n "$DNSREDIR_PATH" ] && [ -f "$DNSREDIR_PATH" ]; then
    export GRAFTCP_INTERNAL_LIB="$DNSREDIR_PATH"
fi

# Select proxy argument based on proxy type
if [ "$PROXY_TYPE" = "socks5" ]; then
    exec "$MGRAFTCP_PATH" --socks5 "$PROXY_ADDR" "$SCRIPT_DIR/$SCRIPT_NAME.bak" "$@"
else
    # Default to http proxy
    exec "$MGRAFTCP_PATH" --http_proxy "$PROXY_ADDR" "$SCRIPT_DIR/$SCRIPT_NAME.bak" "$@"
fi
WRAPPER_EOF

    # Replace placeholders with actual values
    sed -i "s|__PROXY_ADDR_PLACEHOLDER__|$PROXY_ADDR|g" "$TARGET"
    sed -i "s|__PROXY_TYPE_PLACEHOLDER__|$PROXY_TYPE|g" "$TARGET"
    sed -i "s|__EXTENSION_VERSION_PLACEHOLDER__|$EXTENSION_VERSION|g" "$TARGET"
    sed -i "s|__TIMESTAMP_PLACEHOLDER__|$(date -Iseconds)|g" "$TARGET"
    
    # Set extension bin path if provided
    if [ -n "$EXTENSION_PATH" ]; then
        EXTENSION_BIN_DIR="$EXTENSION_PATH/resources/bin"
        sed -i "s|__EXTENSION_BIN_PATH_PLACEHOLDER__|$EXTENSION_BIN_DIR|g" "$TARGET"
    else
        sed -i "s|__EXTENSION_BIN_PATH_PLACEHOLDER__||g" "$TARGET"
    fi

    chmod +x "$TARGET"
    info_log "Wrapper created successfully"
    info_log "  Version: $EXTENSION_VERSION"
    info_log "  Proxy: $PROXY_ADDR ($PROXY_TYPE)"
    CONFIGURED_COUNT=$((CONFIGURED_COUNT + 1))

done <<< "$TARGETS"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================"
echo "Setup Summary"
echo "========================================"
echo "  Extension Version: $EXTENSION_VERSION"
echo "  Proxy Address: $PROXY_ADDR"
echo "  Proxy Type: $PROXY_TYPE"
echo "----------------------------------------"
if [ $CONFIGURED_COUNT -gt 0 ]; then
    echo "  [OK] Configured: $CONFIGURED_COUNT wrapper(s) created/updated"
fi
if [ $SKIPPED_COUNT -gt 0 ]; then
    echo "  [SKIP] Skipped: $SKIPPED_COUNT wrapper(s) already up-to-date"
fi
echo "========================================"

if [ $CONFIGURED_COUNT -gt 0 ]; then
    echo ""
    echo "Setup complete: proxy=$PROXY_ADDR"
    echo "Note: Reload window to apply changes to language server."
    if [ "$TARGET_IS_32BIT" = "1" ] && [ -z "$DNSREDIR_PATH" ]; then
        warn_log "----------------------------------------------------------------"
        warn_log "DEEP REPAIR: Language Server is 32-bit but 32-bit bridge is missing."
        warn_log "Please copy-paste this command to fix it manually:"
        warn_log "sudo apt update && sudo apt install -y build-essential git gcc-arm-linux-gnueabihf"
        warn_log "----------------------------------------------------------------"
    fi
elif [ $SKIPPED_COUNT -gt 0 ]; then
    echo ""
    echo "Already configured with $PROXY_ADDR (v$EXTENSION_VERSION)"
else
    echo ""
    error_log "No language servers were configured!"
    exit 1
fi
