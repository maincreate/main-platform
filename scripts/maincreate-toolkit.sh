#!/usr/bin/env bash
# Main{Create} version-pinned toolkit and device lifecycle adapter.
# This script accepts only fixed toolkit operations; it never executes a project-supplied command.
set -Eeuo pipefail

ROOT="\${MAINCREATE_TOOLKIT_ROOT:-$HOME/.local/share/maincreate/toolkits}"
ESP_ROOT="$ROOT/esp-idf"
EIM_VERSION="0.21.1"
EIM_STATE="$ESP_ROOT/eim-state"
EIM_VERSIONS="$ESP_ROOT/versions"
ANDROID_ROOT="$ROOT/android-sdk"
ANDROID_VERSION="2026.2.2-patch1"
ANDROID_CLI_VERSION="15859902"
ANDROID_TOOLS="$ANDROID_ROOT/cmdline-tools/latest/bin"
ANDROID_BUILD_TOOLS="36.0.0"
ANDROID_PLATFORM_TOOLS="$ANDROID_ROOT/platform-tools"
ANDROID_API_CURRENT="37"
ANDROID_API_LEGACY="22"

die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "Required program not found: $1"; }
valid_version(){ [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
valid_port(){ [[ "$1" =~ ^/dev/(tty(USB|ACM)[0-9]+|serial/by-id/[A-Za-z0-9._:+-]+)$ ]]; }
valid_mac(){ [[ "$1" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]; }
sha256(){ sha256sum "$1" | awk '{print $1}'; }
quote(){ printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

download_verified(){
  local url="$1" expected="$2" out="$3"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || die "Invalid pinned SHA-256"
  mkdir -p "$(dirname "$out")"
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 "$url" -o "$out"
  local actual; actual="$(sha256 "$out")"
  [[ "$actual" == "$expected" ]] || { rm -f "$out"; die "SHA-256 mismatch for $url"; }
}

eim_path(){ printf '%s' "$ESP_ROOT/eim/$EIM_VERSION/eim"; }
eim_run(){
  local version="$1"; shift
  local command="$1"
  local eim; eim="$(eim_path)"
  [[ -x "$eim" ]] || die "EIM CLI $EIM_VERSION is not installed on this builder"
  "$eim" --do-not-track true --esp-idf-json-path "$EIM_STATE" run "$command" "v$version"
}
sdkmanager_path(){ printf '%s' "$ANDROID_TOOLS/sdkmanager"; }
aapt_path(){ printf '%s' "$ANDROID_ROOT/build-tools/$ANDROID_BUILD_TOOLS/aapt"; }
adb_path(){
  if [[ -x "$ANDROID_PLATFORM_TOOLS/adb" ]]; then printf '%s' "$ANDROID_PLATFORM_TOOLS/adb"
  elif command -v adb >/dev/null 2>&1; then command -v adb
  else return 1; fi
}

install_arduino_cli(){
  local version="$1" arch archive digest url stage binary dest
  [[ "$version" == "1.5.1" ]] || die "Unsupported Arduino CLI version"
  case "$(uname -m)" in
    x86_64|amd64) arch="x64";archive="arduino-cli_1.5.1_Linux_64bit.tar.gz";digest="28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b" ;;
    aarch64|arm64) arch="arm64";archive="arduino-cli_1.5.1_Linux_ARM64.tar.gz";digest="1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62" ;;
    *) die "Arduino CLI installation supports Linux x64 and ARM64 only" ;;
  esac
  need curl;need sha256sum;need tar
  local base="$HOME/.local/share/maincreate/sdks/arduino-cli/1.5.1/linux-$arch"
  mkdir -p "$(dirname "$base")"
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN
  download_verified "https://github.com/arduino/arduino-cli/releases/download/v1.5.1/$archive" "$digest" "$stage/arduino.tar.gz"
  tar -tzf "$stage/arduino.tar.gz" > "$stage/entries.txt"
  if grep -E '(^/|(^|/)\.\.(/|$)|\\)' "$stage/entries.txt" >/dev/null; then die "Arduino CLI archive contains an unsafe path"; fi
  tar -xzf "$stage/arduino.tar.gz" -C "$stage" --no-same-owner --no-same-permissions
  binary="$(find "$stage" -maxdepth 2 -type f -name arduino-cli -print -quit)"
  [[ -n "$binary" ]] || die "Arduino CLI archive did not contain its binary"
  "$binary" version | grep -E 'Version:\s*v?1\.5\.1|arduino-cli\s+Version:\s*v?1\.5\.1' >/dev/null ||
    die "Arduino CLI exact-version verification failed"
  mkdir -p "$base"
  install -m 0755 "$binary" "$base/arduino-cli.new"
  mv -f "$base/arduino-cli.new" "$base/arduino-cli"
  "$base/arduino-cli" version | grep -E 'Version:\s*v?1\.5\.1|arduino-cli\s+Version:\s*v?1\.5\.1' >/dev/null ||
    die "Installed Arduino CLI failed exact-version verification"
  rm -rf "$stage";trap - RETURN
  printf 'Installed Arduino CLI %s for Linux %s\n' "$version" "$arch"
}
verify_arduino_cli(){
  [[ "$1" == "1.5.1" ]] || die "Unsupported Arduino CLI version"
  local arch; case "$(uname -m)" in x86_64|amd64) arch="x64";;aarch64|arm64) arch="arm64";;*) die "Unsupported architecture";;esac
  local binary="$HOME/.local/share/maincreate/sdks/arduino-cli/1.5.1/linux-$arch/arduino-cli"
  [[ -x "$binary" ]] || die "Arduino CLI 1.5.1 is not installed"
  "$binary" version | grep -E 'Version:\s*v?1\.5\.1|arduino-cli\s+Version:\s*v?1\.5\.1' >/dev/null ||
    die "Arduino CLI exact-version verification failed"
  printf 'Arduino CLI 1.5.1 verified\n'
}

install_esp_idf(){
  local version="$1" machine archive digest url stage binary
  valid_version "$version" || die "Invalid ESP-IDF version"
  case "$(uname -m)" in
    x86_64|amd64) machine="x64";archive="eim-cli-linux-x64-v$EIM_VERSION.zip";digest="87a1d17c0208fe402269d39f471d862525ca902045b1a97f8af99902342fea8b" ;;
    aarch64|arm64) machine="aarch64";archive="eim-cli-linux-aarch64-v$EIM_VERSION.zip";digest="dbb7db88869b985404757270c4b7e3a62a701759e0c224722a8cfa2414d08180" ;;
    *) die "ESP-IDF managed installation supports Linux x64 and ARM64 only" ;;
  esac
  need curl;need sha256sum;need unzip;need python3
  mkdir -p "$ESP_ROOT/eim" "$EIM_STATE" "$EIM_VERSIONS"
  local install_dir="$ESP_ROOT/eim/$EIM_VERSION"
  if [[ ! -x "$install_dir/eim" ]]; then
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' RETURN
    download_verified "https://github.com/espressif/idf-im-ui/releases/download/v$EIM_VERSION/$archive" "$digest" "$stage/eim.zip"
    unzip -q "$stage/eim.zip" -d "$stage/unpacked"
    binary="$(find "$stage/unpacked" -type f \( -name eim -o -name "eim_$EIM_VERSION" \) -print -quit)"
    [[ -n "$binary" ]] || die "EIM archive did not contain its CLI binary"
    mkdir -p "$install_dir"
    install -m 0755 "$binary" "$install_dir/eim.new"
    mv -f "$install_dir/eim.new" "$install_dir/eim"
    "$install_dir/eim" --version | grep -F "$EIM_VERSION" >/dev/null || die "EIM version verification failed"
    rm -rf "$stage";trap - RETURN
  fi
  local eim; eim="$(eim_path)"
  "$eim" --do-not-track true --esp-idf-json-path "$EIM_STATE" install \
    -p "$EIM_VERSIONS" -i "v$version" -n true --cleanup true
  eim_run "$version" "idf.py --version" | grep -F "v$version" >/dev/null ||
    die "ESP-IDF $version installation did not pass exact-version verification"
  printf 'Installed and verified ESP-IDF %s on Linux %s\n' "$version" "$machine"
}

verify_esp_idf(){
  local version="$1"
  valid_version "$version" || die "Invalid ESP-IDF version"
  eim_run "$version" "idf.py --version" | grep -F "v$version" >/dev/null ||
    die "ESP-IDF $version is not installed or failed version verification"
  printf 'ESP-IDF %s verified\n' "$version"
}

install_android_sdk(){
  local version="$1" accept="$2" archive="commandlinetools-linux-15859902_latest.zip"
  [[ "$version" == "$ANDROID_VERSION" ]] || die "Unsupported Android SDK toolkit version: $version"
  [[ "$accept" == "true" ]] || die "Google Android SDK license acceptance is required before installation"
  [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] ||
    die "Android SDK command-line tools installation is currently supported on Linux x64 only"
  need curl;need sha256sum;need unzip;need java
  java -version 2>&1 | grep -E 'version "(17|18|19|20|21|22|23|24|25)' >/dev/null ||
    die "Android Gradle Plugin requires JDK 17 or newer; install a supported JDK first"
  mkdir -p "$ANDROID_ROOT/cmdline-tools"
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN
  download_verified "https://dl.google.com/android/repository/$archive" \
    "4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583" "$stage/android-cli.zip"
  unzip -q "$stage/android-cli.zip" -d "$stage/unpacked"
  [[ -x "$stage/unpacked/cmdline-tools/bin/sdkmanager" ]] || die "Android command-line tools archive is incomplete"
  rm -rf "$ANDROID_ROOT/cmdline-tools/latest.new"
  mkdir -p "$ANDROID_ROOT/cmdline-tools/latest.new"
  cp -a "$stage/unpacked/cmdline-tools/." "$ANDROID_ROOT/cmdline-tools/latest.new/"
  rm -rf "$ANDROID_ROOT/cmdline-tools/latest.old"
  [[ ! -d "$ANDROID_ROOT/cmdline-tools/latest" ]] || mv "$ANDROID_ROOT/cmdline-tools/latest" "$ANDROID_ROOT/cmdline-tools/latest.old"
  mv "$ANDROID_ROOT/cmdline-tools/latest.new" "$ANDROID_ROOT/cmdline-tools/latest"
  rm -rf "$ANDROID_ROOT/cmdline-tools/latest.old"
  rm -rf "$stage";trap - RETURN
  export ANDROID_HOME="$ANDROID_ROOT" ANDROID_SDK_ROOT="$ANDROID_ROOT"
  local sdkmanager; sdkmanager="$(sdkmanager_path)"
  set +o pipefail
  yes | "$sdkmanager" --sdk_root="$ANDROID_ROOT" --licenses >/dev/null
  yes | "$sdkmanager" --sdk_root="$ANDROID_ROOT" --install \
    "platform-tools" "platforms;android-$ANDROID_API_CURRENT" "platforms;android-$ANDROID_API_LEGACY" \
    "build-tools;$ANDROID_BUILD_TOOLS" >/dev/null
  set -o pipefail
  verify_android_sdk "$version"
}

verify_android_sdk(){
  local version="$1"
  [[ "$version" == "$ANDROID_VERSION" ]] || die "Unsupported Android SDK toolkit version"
  [[ -x "$(sdkmanager_path)" ]] || die "Android SDK command-line tools are missing"
  [[ -x "$(aapt_path)" ]] || die "Android Build-Tools $ANDROID_BUILD_TOOLS are missing"
  [[ -f "$ANDROID_ROOT/platforms/android-$ANDROID_API_CURRENT/android.jar" ]] || die "Android API $ANDROID_API_CURRENT platform is missing"
  [[ -f "$ANDROID_ROOT/platforms/android-$ANDROID_API_LEGACY/android.jar" ]] || die "Android API $ANDROID_API_LEGACY platform is missing"
  local adb; adb="$(adb_path)" || die "ADB is not installed; install Debian packages adb and android-sdk-platform-tools-common on this host"
  "$adb" version | grep -E 'Android Debug Bridge version' >/dev/null || die "ADB version check failed"
  printf 'Android SDK %s verified; API %s and API %s installed\n' "$version" "$ANDROID_API_CURRENT" "$ANDROID_API_LEGACY"
}

json_manifest_esp(){
  local version="$1" out="$2"
  python3 - "$version" "$out" <<'PY'
import hashlib,json,os,re,sys
version,out=sys.argv[1:]
build=os.path.abspath("build")
merged=os.path.join(build,"maincreate-firmware.bin")
desc=os.path.join(build,"project_description.json")
if not os.path.isfile(merged): raise SystemExit("Merged firmware image missing")
target="unknown"
if os.path.isfile(desc):
    try: target=json.load(open(desc,encoding="utf-8")).get("target","unknown")
    except Exception: pass
flash="auto"
sdkconfig="sdkconfig"
if os.path.isfile(sdkconfig):
    text=open(sdkconfig,encoding="utf-8",errors="replace").read()
    m=re.search(r'^CONFIG_ESPTOOLPY_FLASHSIZE="([^"]+)"',text,re.M)
    if m: flash=m.group(1)
h=hashlib.sha256(open(merged,"rb").read()).hexdigest()
json.dump({"schema":1,"artifactType":"esp32-firmware-bundle","toolkit":"esp-idf","toolkitVersion":version,
 "sourceRepository":os.getenv("GITHUB_REPOSITORY",""),"sourceRevision":os.getenv("GITHUB_SHA",""),
 "targetChip":target,"flashSize":flash,"firmwareFile":"maincreate-firmware.bin","sha256":h},open(out,"w"),indent=2)
PY
}

build_esp_idf(){
  local version="$1"
  verify_esp_idf "$version"
  eim_run "$version" "idf.py build"
  eim_run "$version" "idf.py merge-bin -o build/maincreate-firmware.bin"
  [[ -s build/maincreate-firmware.bin ]] || die "ESP-IDF merge-bin did not produce a firmware image"
  json_manifest_esp "$version" build/maincreate-manifest.json
  sha256sum build/maincreate-firmware.bin build/maincreate-manifest.json
}

parse_apk(){
  local apk="$1" out="$2" profile="$3"
  local aapt; aapt="$(aapt_path)"
  local badging; badging="$("$aapt" dump badging "$apk")"
  python3 - "$badging" "$out" "$profile" "$apk" <<'PY'
import hashlib,json,re,sys,os
badging,out,profile,apk=sys.argv[1:]
def one(pattern):
 m=re.search(pattern,badging)
 return m.group(1) if m else None
package=one(r"^package: name='([^']+)'")
sdk=one(r"^sdkVersion:'([^']+)'")
target=one(r"^targetSdkVersion:'([^']+)'")
native=re.findall(r"^native-code: (.+)$",badging,re.M)
abis=[]
if native:
 abis=re.findall(r"'([^']+)'",native[0])
if not package: raise SystemExit("APK package name could not be read")
if profile=="android-legacy-api22-eink":
 if sdk is None or int(sdk)>22: raise SystemExit("Legacy E Ink APK minSdk must be 22 or lower")
 if target is None or int(target)>22: raise SystemExit("Legacy E Ink APK targetSdk must be 22 or lower")
 if abis and "armeabi-v7a" not in abis: raise SystemExit("Native APK must include armeabi-v7a for the E Ink device")
elif profile=="android-current-api37":
 if target is None or int(target)>37: raise SystemExit("Current Android APK targetSdk must be 37 or lower")
else: raise SystemExit("Unknown Android target profile")
digest=hashlib.sha256(open(apk,"rb").read()).hexdigest()
json.dump({"schema":1,"artifactType":"android-application-apk","toolkit":"android-sdk",
 "toolkitVersion":"2026.2.2-patch1","targetProfile":profile,"packageName":package,
 "minSdk":int(sdk) if sdk else None,"targetSdk":int(target) if target else None,
 "nativeAbis":abis,"apkFile":os.path.basename(apk),"sha256":digest,
 "sourceRepository":os.getenv("GITHUB_REPOSITORY",""),"sourceRevision":os.getenv("GITHUB_SHA","")},
 open(out,"w"),indent=2)
PY
}

build_android(){
  local version="$1" profile="$2" variant="$3"
  verify_android_sdk "$version"
  [[ "$profile" == "android-current-api37" || "$profile" == "android-legacy-api22-eink" ]] || die "Unknown Android target profile"
  [[ "$variant" == "debug" || "$variant" == "release" ]] || die "Build variant must be debug or release"
  [[ -x ./gradlew ]] || die "Gradle wrapper ./gradlew is required in the project checkout"
  export ANDROID_HOME="$ANDROID_ROOT" ANDROID_SDK_ROOT="$ANDROID_ROOT"
  ./gradlew --no-daemon --stacktrace "assemble$(tr '[:lower:]' '[:upper:]' <<< "\${variant:0:1}")\${variant:1}"
  local apk; apk="$(find . -type f -path '*/build/outputs/apk/*/*.apk' -print | sort | head -n1)"
  [[ -n "$apk" && -s "$apk" ]] || die "No APK was produced by the Gradle build"
  mkdir -p build/maincreate-artifacts
  cp "$apk" build/maincreate-artifacts/app.apk
  parse_apk build/maincreate-artifacts/app.apk build/maincreate-artifacts/maincreate-manifest.json "$profile"
  sha256sum build/maincreate-artifacts/app.apk build/maincreate-artifacts/maincreate-manifest.json
}

esp_probe(){
  local version="$1" port="$2" output
  valid_version "$version" || die "Invalid ESP-IDF version"
  valid_port "$port" || die "Invalid USB serial port; use /dev/ttyUSBn, /dev/ttyACMn, or /dev/serial/by-id/<name>"
  verify_esp_idf "$version" >/dev/null
  local p; p="$(quote "$port")"
  output="$(eim_run "$version" "esptool.py --port $p chip_id" 2>&1)" ||
    output="$(eim_run "$version" "esptool --port $p chip-id" 2>&1)" ||
    die "Read-only ESP32 chip probe failed on $port"
  printf '%s\n' "$output"
  python3 - "$output" <<'PY'
import re,sys
s=sys.argv[1]
chip=re.search(r'\b(ESP32(?:-S2|-S3|-C3|-C6|-H2|-P4)?)\b',s,re.I)
mac=re.search(r'\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b',s,re.I)
if not chip or not mac: raise SystemExit("Probe did not return both a supported chip family and unique eFuse MAC")
print("MAINCREATE_CHIP="+chip.group(1).upper())
print("MAINCREATE_MAC="+mac.group(0).upper())
PY
}

list_serial_ports(){
  printf '%s\n' "USB serial ports:"
  find /dev/serial/by-id -maxdepth 1 -type l -print 2>/dev/null | sort || true
  find /dev -maxdepth 1 -type c \( -name 'ttyUSB*' -o -name 'ttyACM*' \) -print 2>/dev/null | sort || true
}
list_android_devices(){
  local adb; adb="$(adb_path)" || die "ADB is not installed on this host"
  "$adb" start-server >/dev/null
  "$adb" devices -l
  while read -r serial state _; do
    [[ "$state" == "device" && -n "$serial" && "$serial" != "List" ]] || continue
    printf '\n--- Android device %s ---\n' "$serial"
    probe_android "$serial"
  done < <("$adb" devices | tail -n +2)
}

probe_android(){
  local serial="$1" adb state api abi product model
  [[ -n "$serial" && "$serial" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || die "Invalid Android ADB serial"
  adb="$(adb_path)" || die "ADB is not installed on this host"
  state="$("$adb" devices | awk -v s="$serial" '$1==s {print $2}')"
  [[ "$state" == "device" ]] || die "Android device $serial is not connected and ADB-authorized (state: \${state:-missing})"
  [[ "$("$adb" -s "$serial" get-serialno | tr -d '\r')" == "$serial" ]] || die "ADB serial verification failed"
  api="$("$adb" -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
  abi="$("$adb" -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
  product="$("$adb" -s "$serial" shell getprop ro.product.device | tr -d '\r')"
  model="$("$adb" -s "$serial" shell getprop ro.product.model | tr -d '\r')"
  printf 'serial=%s\napi=%s\nabi=%s\nproduct=%s\nmodel=%s\n' "$serial" "$api" "$abi" "$product" "$model"
}

flash_esp32(){
  local version="$1" port="$2" expected_mac="$3" artifact_dir="$4"
  [[ "\${MAINCREATE_CONFIRM_DEVICE_WRITE:-}" == "true" ]] || die "Device write requires explicit workflow confirmation"
  valid_mac "$expected_mac" || die "Expected eFuse MAC is required"
  [[ -s "$artifact_dir/maincreate-firmware.bin" && -s "$artifact_dir/maincreate-manifest.json" ]] || die "Firmware artifact and manifest are required"
  local manifest_chip manifest_flash manifest_hash observed chip mac p file
  manifest_chip="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("targetChip","unknown"))' "$artifact_dir/maincreate-manifest.json")"
  manifest_flash="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("flashSize","auto"))' "$artifact_dir/maincreate-manifest.json")"
  manifest_hash="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("sha256",""))' "$artifact_dir/maincreate-manifest.json")"
  [[ "$(sha256 "$artifact_dir/maincreate-firmware.bin")" == "$manifest_hash" ]] || die "Firmware artifact SHA-256 does not match its manifest"
  observed="$(esp_probe "$version" "$port")"
  chip="$(sed -n 's/^MAINCREATE_CHIP=//p' <<< "$observed" | tail -n1)"
  mac="$(sed -n 's/^MAINCREATE_MAC=//p' <<< "$observed" | tail -n1)"
  [[ "$mac" == "\${expected_mac^^}" ]] || die "Connected ESP32 eFuse MAC mismatch; expected $expected_mac, found $mac"
  if [[ "$manifest_chip" != "unknown" ]]; then
    [[ "${chip,,}" == "${manifest_chip,,}" ]] || die "Firmware target $manifest_chip does not match detected chip $chip"
  fi
  local flash_info actual_flash
  p="$(quote "$port")"
  flash_info="$(eim_run "$version" "esptool.py --port $p flash_id" 2>&1)" ||
    flash_info="$(eim_run "$version" "esptool --port $p flash-id" 2>&1)" ||
    die "Unable to verify target flash size"
  actual_flash="$(flash_size_bytes "$flash_info")"
  if [[ "$manifest_flash" != "auto" ]]; then
    local expected_flash
    expected_flash="$(python3 - "$manifest_flash" <<'PY'
import re,sys
m=re.fullmatch(r'(\d+)(MB|KB)',sys.argv[1],re.I)
if not m: raise SystemExit("Invalid firmware flash-size metadata")
print(int(m.group(1))*(1024*1024 if m.group(2).upper()=="MB" else 1024))
PY
)"
    [[ "$actual_flash" == "$expected_flash" ]] || die "Firmware expects $manifest_flash flash, device reports $actual_flash bytes"
  fi
  file="$(quote "$artifact_dir/maincreate-firmware.bin")"
  eim_run "$version" "esptool.py --port $p write_flash 0x0 $file" ||
    eim_run "$version" "esptool --port $p write-flash 0x0 $file"
  printf 'Firmware flashed successfully to %s (%s, MAC %s)\n' "$chip" "$port" "$mac"
}

flash_size_bytes(){
  python3 - "$1" <<'PY'
import re,sys
m=re.search(r'Detected flash size:\s*([0-9]+)\s*(MB|KB)',sys.argv[1],re.I)
if not m: raise SystemExit("Could not determine flash size from esptool flash-id output")
n=int(m.group(1)); unit=m.group(2).upper()
print(n*(1024*1024 if unit=="MB" else 1024))
PY
}

backup_esp32(){
  local version="$1" port="$2" expected_mac="$3" output_dir="$4" observed mac p info size out
  valid_mac "$expected_mac" || die "Expected eFuse MAC is required"
  mkdir -p "$output_dir"
  observed="$(esp_probe "$version" "$port")"
  mac="$(sed -n 's/^MAINCREATE_MAC=//p' <<< "$observed" | tail -n1)"
  [[ "$mac" == "\${expected_mac^^}" ]] || die "Connected ESP32 eFuse MAC mismatch"
  p="$(quote "$port")"
  info="$(eim_run "$version" "esptool.py --port $p flash_id" 2>&1)" ||
    info="$(eim_run "$version" "esptool --port $p flash-id" 2>&1)" ||
    die "Unable to read flash ID"
  size="$(flash_size_bytes "$info")"
  out="$output_dir/esp32-full-flash.bin"
  local qout; qout="$(quote "$out")"
  eim_run "$version" "esptool.py --port $p read_flash 0x0 $size $qout" ||
    eim_run "$version" "esptool --port $p read-flash 0x0 $size $qout"
  python3 - "$out" "$output_dir/backup-manifest.json" "$version" "$mac" "$size" "$observed" <<'PY'
import hashlib,json,os,sys
binary,manifest,version,mac,size,probe=sys.argv[1:]
chip="unknown"
for line in probe.splitlines():
 if line.startswith("MAINCREATE_CHIP="): chip=line.split("=",1)[1]
digest=hashlib.sha256(open(binary,"rb").read()).hexdigest()
json.dump({"schema":1,"artifactType":"esp32-full-flash-backup","toolkit":"esp-idf",
 "toolkitVersion":version,"sourceDeviceMac":mac,"chip":chip,"flashSizeBytes":int(size),
 "firmwareFile":os.path.basename(binary),"sha256":digest},open(manifest,"w"),indent=2)
PY
  printf 'Full flash backup created for %s (%s bytes)\n' "$mac" "$size"
}

restore_esp32(){
  local version="$1" port="$2" expected_mac="$3" backup_dir="$4"
  [[ "\${MAINCREATE_CONFIRM_DEVICE_WRITE:-}" == "true" ]] || die "Restore requires explicit workflow confirmation"
  valid_mac "$expected_mac" || die "Expected eFuse MAC is required"
  [[ -s "$backup_dir/esp32-full-flash.bin" && -s "$backup_dir/backup-manifest.json" ]] || die "Backup binary and manifest are required"
  local observed chip mac p size recorded_mac recorded_chip recorded_size digest file
  observed="$(esp_probe "$version" "$port")"
  chip="$(sed -n 's/^MAINCREATE_CHIP=//p' <<< "$observed" | tail -n1)"
  mac="$(sed -n 's/^MAINCREATE_MAC=//p' <<< "$observed" | tail -n1)"
  [[ "$mac" == "\${expected_mac^^}" ]] || die "Connected ESP32 eFuse MAC mismatch"
  read -r recorded_mac recorded_chip recorded_size digest < <(python3 - "$backup_dir/backup-manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m.get("sourceDeviceMac",""),m.get("chip",""),m.get("flashSizeBytes",""),m.get("sha256",""))
PY
)
  [[ "$recorded_mac" == "$mac" ]] || die "Backup belongs to a different physical ESP32 (MAC mismatch)"
  [[ "\${recorded_chip,,}" == "\${chip,,}" ]] || die "Backup chip family does not match target"
  [[ "$(sha256 "$backup_dir/esp32-full-flash.bin")" == "$digest" ]] || die "Backup SHA-256 verification failed"
  p="$(quote "$port")";file="$(quote "$backup_dir/esp32-full-flash.bin")"
  local flash_info actual_size
  flash_info="$(eim_run "$version" "esptool.py --port $p flash_id" 2>&1)" ||
    flash_info="$(eim_run "$version" "esptool --port $p flash-id" 2>&1)" ||
    die "Unable to verify target flash size"
  actual_size="$(flash_size_bytes "$flash_info")"
  [[ "$actual_size" == "$recorded_size" ]] || die "Backup flash size does not match the connected device"
  size="$(stat -c '%s' "$backup_dir/esp32-full-flash.bin")"
  [[ "$size" == "$recorded_size" ]] || die "Backup length does not match its recorded flash size"
  eim_run "$version" "esptool.py --port $p write_flash 0x0 $file" ||
    eim_run "$version" "esptool --port $p write-flash 0x0 $file"
  printf 'Full flash restore completed for %s\n' "$mac"
}

install_android_app(){
  local serial="$1" apk="$2" profile="$3" adb manifest package api abi
  [[ "\${MAINCREATE_CONFIRM_DEVICE_WRITE:-}" == "true" ]] || die "Android app install requires explicit workflow confirmation"
  [[ -s "$apk" ]] || die "APK artifact is missing"
  manifest="$(dirname "$apk")/maincreate-manifest.json"
  [[ -s "$manifest" ]] || die "APK manifest is missing"
  adb="$(adb_path)" || die "ADB is not installed on the deployment builder"
  local device; device="$(probe_android "$serial")"
  api="$(sed -n 's/^api=//p' <<< "$device" | head -n1)"
  abi="$(sed -n 's/^abi=//p' <<< "$device" | head -n1)"
  package="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("packageName",""))' "$manifest")"
  local min target
  min="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("minSdk") or 1)' "$manifest")"
  target="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("targetSdk") or 0)' "$manifest")"
  [[ -n "$package" && "$min" -le "$api" ]] || die "APK package or minSdk is incompatible with the Android device"
  if [[ "$profile" == "android-legacy-api22-eink" ]]; then
    [[ "$api" == "22" && "$target" -le 22 ]] || die "Legacy E Ink deployment requires Android API 22 and targetSdk <= 22"
    [[ "$abi" == "armeabi-v7a" ]] || die "E Ink device ABI is not armeabi-v7a"
  elif [[ "$profile" != "android-current-api37" ]]; then die "Unknown Android target profile"; fi
  "$adb" -s "$serial" install -r "$apk"
  printf 'Installed %s on Android device %s (API %s, ABI %s)\n' "$package" "$serial" "$api" "$abi"
}

backup_android_app(){
  local serial="$1" package="$2" output_dir="$3" adb paths base
  [[ "$package" =~ ^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$ ]] || die "Invalid Android package name"
  adb="$(adb_path)" || die "ADB is not installed"
  probe_android "$serial" >/dev/null
  paths="$("$adb" -s "$serial" shell pm path "$package" | tr -d '\r')"
  base="$(sed -n 's/^package://p' <<< "$paths" | head -n1)"
  [[ -n "$base" ]] || die "Package is not installed on the Android device"
  mkdir -p "$output_dir"
  "$adb" -s "$serial" pull "$base" "$output_dir/app.apk" >/dev/null
  python3 - "$output_dir/app.apk" "$output_dir/backup-manifest.json" "$package" "$serial" <<'PY'
import hashlib,json,os,sys
apk,manifest,package,serial=sys.argv[1:]
digest=hashlib.sha256(open(apk,"rb").read()).hexdigest()
json.dump({"schema":1,"artifactType":"android-installed-application-backup","packageName":package,
 "sourceDeviceSerial":serial,"apkFile":os.path.basename(apk),"sha256":digest,
 "dataIncluded":False,"note":"APK-only backup; private application data is not included."},open(manifest,"w"),indent=2)
PY
  printf 'APK backup created for %s; private app data is not included\n' "$package"
}

restore_android_app(){
  local serial="$1" apk="$2" adb package expected digest manifest
  [[ "\${MAINCREATE_CONFIRM_DEVICE_WRITE:-}" == "true" ]] || die "Android restore requires explicit workflow confirmation"
  manifest="$(dirname "$apk")/backup-manifest.json"
  [[ -s "$apk" && -s "$manifest" ]] || die "Android APK backup and manifest are required"
  adb="$(adb_path)" || die "ADB is not installed"
  probe_android "$serial" >/dev/null
  read -r package expected digest < <(python3 - "$manifest" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m.get("packageName",""),m.get("sourceDeviceSerial",""),m.get("sha256",""))
PY
)
  [[ "$expected" == "$serial" ]] || die "Android backup belongs to a different device serial"
  [[ "$(sha256 "$apk")" == "$digest" ]] || die "Android APK backup checksum mismatch"
  "$adb" -s "$serial" install -r "$apk"
  printf 'Restored application %s on %s\n' "$package" "$serial"
}

cleanup_toolkit(){
  local family="$1" version="$2" confirm="$3"
  [[ "$confirm" == "true" ]] || { printf 'DRY RUN: would clean %s@%s only; no files changed.\n' "$family" "$version"; return 0; }
  case "$family" in
    arduino-cli)
      [[ "$version" == "1.5.1" ]] || die "Unsupported Arduino CLI version"
      local arch; case "$(uname -m)" in x86_64|amd64) arch="x64";;aarch64|arm64) arch="arm64";;*) die "Unsupported architecture";;esac
      local binary="$HOME/.local/share/maincreate/sdks/arduino-cli/1.5.1/linux-$arch/arduino-cli"
      [[ -x "$binary" ]] || die "Arduino CLI 1.5.1 is not installed"
      rm -f "$binary"
      ;;
    esp-idf)
      valid_version "$version" || die "Invalid ESP-IDF version"
      local eim; eim="$(eim_path)"
      [[ -x "$eim" ]] || die "EIM CLI is not installed"
      "$eim" --do-not-track true --esp-idf-json-path "$EIM_STATE" list
      "$eim" --do-not-track true --esp-idf-json-path "$EIM_STATE" remove "v$version"
      ;;
    android-sdk)
      [[ "$version" == "$ANDROID_VERSION" ]] || die "Unsupported Android SDK toolkit version"
      [[ -x "$(sdkmanager_path)" ]] || die "Android SDK manager is missing"
      # Keep shared command-line tools, platform-tools, and API 22 legacy target.
      yes | "$(sdkmanager_path)" --sdk_root="$ANDROID_ROOT" --uninstall \
        "platforms;android-$ANDROID_API_CURRENT" "build-tools;$ANDROID_BUILD_TOOLS"
      ;;
    *) die "Unknown toolkit family" ;;
  esac
  printf 'Cleanup completed for %s@%s. Shared tools and project data were preserved.\n' "$family" "$version"
}

usage(){
cat <<'EOF'
Main{Create} toolkit lifecycle adapter
  install esp-idf VERSION
  install arduino-cli 1.5.1
  install android-sdk VERSION --accept-licenses
  verify esp-idf VERSION
  verify android-sdk VERSION
  build esp-idf VERSION
  build android-sdk VERSION TARGET_PROFILE debug|release
  probe-esp32 VERSION PORT
  probe-android ADB_SERIAL
  list-serial
  list-android
  flash-esp32 VERSION PORT EXPECTED_EFUSE_MAC ARTIFACT_DIR   (requires MAINCREATE_CONFIRM_DEVICE_WRITE=true)
  backup-esp32 VERSION PORT EXPECTED_EFUSE_MAC OUTPUT_DIR
  restore-esp32 VERSION PORT EXPECTED_EFUSE_MAC BACKUP_DIR  (requires MAINCREATE_CONFIRM_DEVICE_WRITE=true)
  install-android ADB_SERIAL APK TARGET_PROFILE            (requires MAINCREATE_CONFIRM_DEVICE_WRITE=true)
  backup-android ADB_SERIAL PACKAGE OUTPUT_DIR
  restore-android ADB_SERIAL APK                            (requires MAINCREATE_CONFIRM_DEVICE_WRITE=true)
  cleanup esp-idf|android-sdk VERSION true|false
EOF
}

case "\${1:-}" in
 install)
  case "\${2:-}" in
   esp-idf) [[ $# -eq 3 ]] || die "Usage: install esp-idf VERSION"; install_esp_idf "$3" ;;
   arduino-cli) [[ $# -eq 3 ]] || die "Usage: install arduino-cli VERSION"; install_arduino_cli "$3" ;;
   android-sdk) [[ $# -eq 4 && "$4" == "--accept-licenses" ]] || die "Usage: install android-sdk VERSION --accept-licenses"; install_android_sdk "$3" true ;;
   *) die "Unknown toolkit family" ;;
  esac ;;
 verify)
  case "\${2:-}" in
   esp-idf) verify_esp_idf "\${3:-}" ;;
   android-sdk) verify_android_sdk "\${3:-}" ;;
   *) die "Unknown toolkit family" ;;
  esac ;;
 build)
  case "\${2:-}" in
   esp-idf) [[ $# -eq 3 ]] || die "Usage: build esp-idf VERSION"; build_esp_idf "$3" ;;
   android-sdk) [[ $# -eq 5 ]] || die "Usage: build android-sdk VERSION TARGET_PROFILE debug|release"; build_android "$3" "$4" "$5" ;;
   *) die "Unknown toolkit family" ;;
  esac ;;
 probe-esp32) [[ $# -eq 3 ]] || die "Usage: probe-esp32 VERSION PORT"; esp_probe "$2" "$3" ;;
 probe-android) [[ $# -eq 2 ]] || die "Usage: probe-android ADB_SERIAL"; probe_android "$2" ;;
 list-serial) [[ $# -eq 1 ]] || die "Usage: list-serial"; list_serial_ports ;;
 list-android) [[ $# -eq 1 ]] || die "Usage: list-android"; list_android_devices ;;
 flash-esp32) [[ $# -eq 5 ]] || die "Usage: flash-esp32 VERSION PORT EXPECTED_MAC ARTIFACT_DIR"; flash_esp32 "$2" "$3" "$4" "$5" ;;
 backup-esp32) [[ $# -eq 5 ]] || die "Usage: backup-esp32 VERSION PORT EXPECTED_MAC OUTPUT_DIR"; backup_esp32 "$2" "$3" "$4" "$5" ;;
 restore-esp32) [[ $# -eq 5 ]] || die "Usage: restore-esp32 VERSION PORT EXPECTED_MAC BACKUP_DIR"; restore_esp32 "$2" "$3" "$4" "$5" ;;
 install-android) [[ $# -eq 4 ]] || die "Usage: install-android ADB_SERIAL APK TARGET_PROFILE"; install_android_app "$2" "$3" "$4" ;;
 backup-android) [[ $# -eq 4 ]] || die "Usage: backup-android ADB_SERIAL PACKAGE OUTPUT_DIR"; backup_android_app "$2" "$3" "$4" ;;
 restore-android) [[ $# -eq 3 ]] || die "Usage: restore-android ADB_SERIAL APK"; restore_android_app "$2" "$3" ;;
 cleanup) [[ $# -eq 4 ]] || die "Usage: cleanup FAMILY VERSION CONFIRM"; cleanup_toolkit "$2" "$3" "$4" ;;
 -h|--help|"") usage ;;
 *) usage; die "Unknown operation" ;;
esac
