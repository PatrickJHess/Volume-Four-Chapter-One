#  Imported Functions




:::{dropdown} Click to see `FredReader`

```py
class FredReader:
    def __init__(self, api_key=None, key_name="fred_key", cache_dir="fred"):
        # --- COLAB PERSISTENCE LOGIC ---
        if 'google.colab' in sys.modules:
            print("☁️ Colab environment detected. Mounting Google Drive...")
            from google.colab import drive
            try:
                drive.mount('/content/drive')
                self.cache_dir = '/content/drive/MyDrive/FRED'
            except Exception as e:
                print(f"✅ Drive mount failed, defaulting to local cache: {e}")
                self.cache_dir = cache_dir
        else:
            self.cache_dir = cache_dir

        self.api_key = None
        
        # This list prioritizes their custom name, then tries all standard variations
        fallback_names = [key_name, "fred_key", "FRED_API_KEY", "FRED_KEY"]

        # --- 1. EXPLICIT KEY PASSED ---
        if api_key:
            self.api_key = api_key

        # --- 2. CHECK COLAB SECRETS ---
        elif 'google.colab' in sys.modules:
            try:
                from google.colab import userdata
                for name_to_check in fallback_names:
                    try:
                        # Colab throws an error if the secret doesn't exist, so we catch it
                        potential_key = userdata.get(name_to_check)
                        if potential_key:
                            self.api_key = potential_key
                            print(f"✅ Key loaded seamlessly from Colab Secrets ('{name_to_check}')")
                            break # Stop searching, we found it!
                    except Exception:
                        continue # Secret not found, try the next name in the list
            except ImportError:
                pass 

        # --- 3. CHECK OS ENVIRONMENT (Local/Binder/Setup Wizard) ---
        if not self.api_key:
            for name_to_check in fallback_names:
                if os.environ.get(name_to_check):
                    self.api_key = os.environ.get(name_to_check)
                    print(f"✅ Key loaded from local environment ('{name_to_check}')")
                    break # Stop searching, we found it!

        # --- 4. FALLBACK PROMPT ---
        if not self.api_key:
            print(f"⚠️ Could not find a key named '{key_name}' (or standard fallbacks) in Colab Secrets or local environment.")
            print("If you have a FRED key, paste it now; otherwise just press Enter:")
            key_input = getpass.getpass(prompt="> ")
            if key_input.strip():
                self.api_key = key_input.strip()
                os.environ[key_name] = self.api_key # Save it for later cells using their preferred name!
                print("✅ Key loaded successfully from manual input!")
            else:
                print("⚠️ No key entered. Defaulting to pandas_datareader.")

        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)

    # --- REACTIVE NETWORK SHIELD ---
    def _make_api_request(self, url, max_retries=3, series_id=None):
        """Universal helper to handle API calls, 429 Too Many Requests, and graceful 400 errors."""
        import time
        import requests
        
        for attempt in range(max_retries):
            try:
                response = requests.get(url)
            except requests.exceptions.RequestException:
                print(f"🌩️ NETWORK ERROR: Failed to reach FRED servers.")
                return None
            
            # 1. Rate Limit Catch (HTTP 429)
            if response.status_code == 429:
                wait_time = 5 * (attempt + 1)
                print(f"🚦 Rate limit hit (HTTP 429)! Sleeping for {wait_time}s (Attempt {attempt + 1}/{max_retries})...")
                time.sleep(wait_time)
                continue
                
            # 2. Graceful Bad Request Catch (HTTP 400)
            if response.status_code == 400:
                try:
                    error_msg = response.json().get("error_message", "Unknown FRED API error")
                except ValueError:
                    error_msg = "Invalid request (No JSON message provided by FRED)."
                
                context_str = f" for '{series_id}'" if series_id else ""
                print(f"❌ API REJECTED{context_str}: {error_msg}")
                return None  
                
            # 3. Hard Crash Prevention for other HTTP errors (like 500 Server Error)
            try:
                response.raise_for_status()
            except requests.exceptions.HTTPError as e:
                print(f"🌩️ HTTP ERROR: {e}")
                return None

            # 4. Success! Safely unpack the JSON.
            try:
                return response.json()
            except ValueError:
                print(f"❌ ERROR: FRED returned a successful status, but the data is not valid JSON.")
                return None
            
        print(f"❌ Max retries ({max_retries}) exceeded. The API is strictly rate-limiting you.")
        return None

    # --- PUBLIC WRAPPER METHOD ---
    def get_series(self, series_ids, start_date=None, end_date=None, ttl_days=7):
        """Fetches one or more series and returns them in a single merged DataFrame."""
        if isinstance(series_ids, str):
            series_ids = [series_ids]
        elif not hasattr(series_ids, '__iter__'):
            raise TypeError("series_ids must be a string or an iterable of strings.")

        dataframes = []

        for series_id in series_ids:
            print(f"\n☁️--- Processing {series_id} ---")

            df = self._get_single_series(series_id, start_date=start_date, end_date=end_date, ttl_days=ttl_days)
            if df is not None and not df.empty:
                dataframes.append(df)
            else:
                print(f"⚠️ Skipping {series_id}: No data was returned.")

        if dataframes:
            if len(dataframes) == 1:
                return dataframes[0]
            print("\n🧩 Merging all series into a single DataFrame...")
            combined_df = pd.concat(dataframes, axis=1, join='outer')
            combined_df.sort_index(inplace=True)
            print("✅ Merge complete!")
            return combined_df
        else:
            print("❌ No data could be retrieved.")
            return None

    # --- CORE WORKHORSE METHOD ---
    def _get_single_series(self, series_id, start_date=None, end_date=None, ttl_days=7):
        import datetime as dt
        series_dir = os.path.join(self.cache_dir, series_id)

        filepath = os.path.abspath(os.path.join(series_dir, f"{series_id}_fred.csv"))
        metadata_file = os.path.abspath(os.path.join(series_dir, "cache_metadata.json"))

        metadata = {}
        metadata_is_stale = True
        metadata_updated_this_run = False

        # --- NESTED METADATA HELPER ---
        def update_metadata():
            nonlocal metadata, metadata_updated_this_run
            if not self.api_key: return True
            
            meta_url = f"https://api.stlouisfed.org/fred/series?series_id={series_id}&api_key={self.api_key}&file_type=json"
            try:
                meta_data = self._make_api_request(meta_url, series_id=series_id)
                
                if not meta_data:
                    return False

                if 'seriess' in meta_data and len(meta_data['seriess']) > 0:
                    series_info = meta_data['seriess'][0]
                    metadata['series_inception'] = series_info.get('observation_start')
                    metadata['series_last_observed'] = series_info.get('observation_end')
                    metadata['title'] = series_info.get('title')
                    metadata['frequency'] = series_info.get('frequency')
                    metadata['last_updated'] = dt.datetime.now(dt.timezone.utc).isoformat()
                    
                    os.makedirs(series_dir, exist_ok=True)

                    # Note: Because 'metadata' is modified in place, existing cache_start/cache_end
                    # are perfectly preserved here. We do not change them during a routine ping.
                    with open(metadata_file, 'w') as f:
                        json.dump(metadata, f, indent=4)
                    
                    metadata_updated_this_run = True
                    print("⏳ Metadata synced and timestamp updated.")
                    return True
            except Exception as e:
                print(f"⚠️ Could not update metadata: {e}")
                return False

        # --- 1. READ LOCAL METADATA ---
        if os.path.exists(metadata_file):
            try:
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
            except (json.JSONDecodeError, ValueError) as e:
                print(f"⚠️ Warning: Corrupt or empty metadata cache found for {series_id}. Resetting file...")
                metadata = {}
                try:
                    os.remove(metadata_file) 
                except Exception:
                    pass
                
            if 'last_updated' in metadata:
                last_updated = dt.datetime.fromisoformat(metadata['last_updated'])
                if last_updated.tzinfo is None:
                    last_updated = last_updated.replace(tzinfo=dt.timezone.utc)
                
                days_old = (dt.datetime.now(dt.timezone.utc) - last_updated).days
                
                if days_old < ttl_days:
                    metadata_is_stale = False
                    print(f"🕒 Metadata is fresh ({days_old} days old).")
                else:
                    print(f"⏳ Metadata is {days_old} days old (TTL: {ttl_days}). It's stale.")

        # --- 2. SMART PING ---
        if not metadata:
            print(f"🆕 First run for {series_id}. Initializing metadata...")
            if not update_metadata():
              return None

        elif self.api_key and end_date and 'series_last_observed' in metadata and metadata_is_stale:
            if pd.to_datetime(end_date) > pd.to_datetime(metadata['series_last_observed']):
                print(f"🔎 Requested date exceeds known end date. Checking for updates...")
                update_metadata()

        # --- 3. CLAMP DATES ---
        if 'series_inception' in metadata and start_date:
            clamped_start = max(pd.to_datetime(start_date), pd.to_datetime(metadata['series_inception']))
            if pd.to_datetime(start_date) < clamped_start:
                start_date = clamped_start.strftime('%Y-%m-%d')
                print(f'⚠️ Adjusted start date to First Available Data: {start_date}')

        if 'series_last_observed' in metadata and end_date:
            clamped_end = min(pd.to_datetime(end_date), pd.to_datetime(metadata['series_last_observed']))
            if pd.to_datetime(end_date) > clamped_end:
                end_date = clamped_end.strftime('%Y-%m-%d')
                print(f'⚠️ FRED has no data past {end_date}. Adjusted request to match.')

        # --- 4. CHECK LOCAL CACHE ---
        cache_valid = False
        cache_start = None
        cache_end = None

        if os.path.exists(filepath):
            cache_valid = True

            if metadata_is_stale:
                cache_valid = False
                print(f"♻️ TTL expired. Forcing data and metadata refresh for {series_id}...")

            if cache_valid:
                if 'cache_start' in metadata and 'cache_end' in metadata:
                    cache_start = pd.to_datetime(metadata['cache_start'])
                    cache_end = pd.to_datetime(metadata['cache_end'])
                else:
                    try:
                        temp_df = pd.read_csv(filepath, index_col='DATE', parse_dates=True)
                        if not temp_df.empty:
                            cache_start = temp_df.index.min()
                            cache_end = temp_df.index.max()
                        else:
                            cache_valid = False
                    except Exception:
                        cache_valid = False

                if cache_valid and cache_start is not None:
                    if start_date and pd.to_datetime(start_date) < cache_start:
                        if len(pd.bdate_range(start_date, cache_start, inclusive='left')) > 0:
                            cache_valid = False

                    if end_date and pd.to_datetime(end_date) > cache_end:
                        freq_str = metadata.get('frequency', '')
                        if 'Annual' in freq_str:
                            cache_end_coverage = cache_end + pd.DateOffset(years=1) - pd.Timedelta(days=1)
                        elif 'Quarterly' in freq_str:
                            cache_end_coverage = cache_end + pd.DateOffset(months=3) - pd.Timedelta(days=1)
                        elif 'Monthly' in freq_str:
                            cache_end_coverage = cache_end + pd.DateOffset(months=1) - pd.Timedelta(days=1)
                        elif 'Weekly' in freq_str:
                            cache_end_coverage = cache_end + pd.Timedelta(days=6)
                        else:
                            cache_end_coverage = cache_end 
                        
                        if pd.to_datetime(end_date) > cache_end_coverage:
                            cache_valid = False

            if cache_valid:
                print(f"✅ Loaded {series_id} from local cache.")
                df = pd.read_csv(filepath, index_col='DATE', parse_dates=True)
                if start_date:
                    df = df[df.index >= pd.to_datetime(start_date)]
                if end_date:
                    df = df[df.index <= pd.to_datetime(end_date)]
                return df
            else:
                print(f"♻️ Cache missing or insufficient bounds. Killing cache for {series_id}...")
                try:
                    os.remove(filepath)
                except OSError:
                    pass
                
                # 🛠️ CRITICAL FIX: If we destroy the CSV, we MUST clear the start/end dates 
                # from the metadata immediately so we don't leave phantom dates behind.
                keys_removed = False
                if 'cache_start' in metadata:
                    del metadata['cache_start']
                    keys_removed = True
                if 'cache_end' in metadata:
                    del metadata['cache_end']
                    keys_removed = True
                
                if keys_removed:
                    with open(metadata_file, 'w') as f:
                        json.dump(metadata, f, indent=4)

        # --- 5. API FETCH ---
        print(f"☁️ Fetching fresh {series_id} observations...")
        if not metadata_updated_this_run and metadata_is_stale:
            if not update_metadata():
              return None

        try:
            if self.api_key is None:
                print("⚠️ No API key found. Defaulting to pandas_datareader...")
                df = web.DataReader(series_id, 'fred', start=start_date, end=end_date)
            else:
                url = f"https://api.stlouisfed.org/fred/series/observations?series_id={series_id}&api_key={self.api_key}&file_type=json"
                if start_date: url += f"&observation_start={start_date}"
                if end_date: url += f"&observation_end={end_date}"

                safe_url = url.replace(self.api_key, "HIDDEN_KEY")
                print(f"📡 Sending URL to FRED: {safe_url}")

                data = self._make_api_request(url)

                if not data or 'observations' not in data:
                  print(f"❌ API Error: Could not retrieve observation data for {series_id}.")
                  return None

                df = pd.DataFrame(data['observations'])
                df['DATE'] = pd.to_datetime(df['date'])
                df[series_id] = pd.to_numeric(df['value'], errors='coerce')
                df = df.set_index('DATE')
                df = df[[series_id]]

            df.dropna(inplace=True)
            
            os.makedirs(series_dir, exist_ok=True)            
 
            df.to_csv(filepath)
            
            # 🛠️ CRITICAL FIX: We ONLY change the start and end dates here, 
            # proving we have actually replaced the cache file successfully.
            if not df.empty:
                metadata['cache_start'] = df.index.min().strftime('%Y-%m-%d')
                metadata['cache_end'] = df.index.max().strftime('%Y-%m-%d')
                with open(metadata_file, 'w') as f:
                    json.dump(metadata, f, indent=4)
                    
            print(f"Success! Data saved to {filepath}.")
            return df

        except Exception as e:
            print(f"❌ An error occurred: {e}")
            return None```
:::


:::{dropdown} Click to see `secure_key_setup`

```py
def secure_key_setup(key_name="FRED_KEY"):
    """
    The master UI for setting up API keys. Handles Colab, Local Jupyter,
    and Ephemeral (Binder) environments automatically, with live validation.
    """
    try:
        from IPython.display import clear_output, display, HTML
    except ImportError:
        clear_output = lambda: None
        display = lambda x: print(x)
        HTML = lambda x: x

    # --- INTERNAL VALIDATION HELPER ---
    def _validate_key(name, value):
        import requests
        name_upper = name.upper()

        if "FRED" in name_upper:
            print(f"🔒 Authenticating {name} with FRED servers...")
            if len(value) != 32: return False
            try:
                url = f"https://api.stlouisfed.org/fred/series?series_id=GDP&api_key={value}&file_type=json"
                return requests.get(url).status_code == 200
            except Exception: return False

        elif "ALPHA" in name_upper:
            print(f"🔒 Authenticating {name} with AlphaVantage...")
            try:
                url = f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey={value}"
                resp = requests.get(url).json()
                return "Error Message" not in resp
            except Exception: return False

        elif "MASSIVE" in name_upper:
            print(f"🔒 Authenticating {name} with Massive reference servers...")
            try:
                url = f"https://api.massive.com/v3/reference/tickers?limit=1&apiKey={value}"
                return requests.get(url).status_code == 200
            except Exception: return False

        else:
            # The graceful bypass for custom keys
            print(f"ℹ️ Note: '{name}' is not recognized as FRED, ALPHA, or MASSIVE.")
            print(f"   Skipping live network validation. Key loaded directly.")
            return True

    # 1. Detect Environment
    import sys, os, getpass
    in_colab = 'google.colab' in sys.modules
    in_binder = 'BINDER_URL' in os.environ or 'BINDER_PORT' in os.environ

    class StopExecution(Exception):
        def _render_traceback_(self):
            pass

    if in_colab:
        from google.colab import userdata
        from google.colab import output

        status_msg = "" # Used to display errors if they click the button too early

        while True:
            try:
                # STATE 1: Vault Check
                colab_key = userdata.get(key_name)
                if colab_key:
                    clear_output()
                    if _validate_key(key_name, colab_key):
                        os.environ[key_name] = colab_key
                        clear_output()
                        display(HTML(f"""
                        <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; border-left: 6px solid #28a745; max-width: 600px; font-family: sans-serif;">
                            <h4 style="margin-top: 0; color: #155724; margin-bottom: 5px;">&#10004;&#65039; Key Authenticated & Active!</h4>
                            <p style="margin-top: 0; color: #155724; margin-bottom: 0;">We verified <b>{key_name}</b> from your Secrets and securely loaded it. You are ready to fetch data!</p>
                        </div>
                        """))
                        return
                    else:
                        status_msg = f"""
                        <div style="background-color: #f8d7da; padding: 15px; border-radius: 8px; border-left: 6px solid #dc3545; max-width: 600px; font-family: sans-serif; margin-bottom: 15px;">
                            <h4 style="margin-top: 0; color: #721c24; margin-bottom: 5px;">&#10060; Invalid Key Detected</h4>
                            <p style="margin-top: 0; color: #721c24; margin-bottom: 0;">We found <b>{key_name}</b>, but authentication failed. Please fix any typos in the sidebar.</p>
                        </div>
                        """
            except Exception as e:
                # STATE 2: Locked (NotebookAccessError)
                if "Access" in str(type(e).__name__):
                    status_msg = f"""
                    <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border-left: 6px solid #ffc107; max-width: 600px; font-family: sans-serif; margin-bottom: 15px;">
                        <h4 style="margin-top: 0; color: #856404; margin-bottom: 5px;">&#128273; Activation Required</h4>
                        <p style="margin-top: 0; color: #856404; margin-bottom: 0;">We found <b>{key_name}</b>, but you forgot to toggle <b>"Notebook access"</b> to ON. Please toggle it and try again.</p>
                    </div>
                    """
                else:
                    pass # Doesn't exist yet, which is perfectly normal.

            # --- STATE 3: THE SEAMLESS SETUP WIZARD ---
            clear_output()
            if status_msg:
                display(HTML(status_msg))
                status_msg = "" # Clear it so it doesn't loop forever

            display(HTML(f"""
            <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin-bottom: 15px;">
                <div style="background-color: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">
                    <h3 style="margin: 0; color: #1a73e8;">&#128274; {key_name} Setup Required</h3>
                </div>
                <div style="padding: 20px;">
                    <p style="margin-top: 0; margin-bottom: 15px;">Follow these fast steps to securely store your API key:</p>
                    <ol style="margin-top: 0; padding-left: 20px; line-height: 1.8; color: #333;">
                        <li>Click the <b>Key Icon</b> (&#128273;) on the left sidebar.</li>
                        <li>Click <b>"Add new secret"</b>.</li>
                        <li>Paste your actual API Key into the <b>"Value"</b> box first (since it's on your clipboard!).</li>
                        <li>Copy this exact name: <button onclick="navigator.clipboard.writeText('{key_name}'); this.innerHTML='&#9989; Copied!'; setTimeout(() => this.innerHTML='&#128203; {key_name}', 2000);" style="margin-left: 8px; padding: 4px 8px; background: #e8f0fe; color: #1a73e8; border: 1px solid #1a73e8; border-radius: 4px; cursor: pointer; font-family: monospace; font-weight: bold;">&#128203; {key_name}</button><br>and paste it into the <b>"Name"</b> box.</li>
                        <li>Toggle <b>"Notebook access"</b> to <span style="color: #1a73e8; font-weight: bold;">ON (Blue)</span>.</li>
                    </ol>
                    
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button id="check-btn-{key_name}" style="flex: 2; padding: 12px; background: #34a853; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; transition: 0.2s;">
                            &#10004;&#65039; Authenticate Now
                        </button>
                        <button id="stop-btn-{key_name}" style="flex: 1; padding: 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; transition: 0.2s;">
                            &#10060; Stop
                        </button>
                    </div>
                </div>
            </div>

<script>
              // The Promise now listens to BOTH buttons and returns a command string
              window.promise_{key_name} = new Promise(function(resolve) {{
                
                document.getElementById('check-btn-{key_name}').onclick = function() {{
                  this.innerHTML = "&#8987; Authenticating...";
                  this.style.backgroundColor = "#2d9249";
                  this.style.pointerEvents = "none";
                  document.getElementById('stop-btn-{key_name}').style.pointerEvents = "none";
                  resolve("check"); // Signal Python to loop and check again
                }};
                
                document.getElementById('stop-btn-{key_name}').onclick = function() {{
                  this.innerHTML = "Stopping...";
                  this.style.backgroundColor = "#c82333";
                  this.style.pointerEvents = "none";
                  document.getElementById('check-btn-{key_name}').style.pointerEvents = "none";
                  resolve("stop"); // Signal Python to halt execution
                }};
                
              }});
            </script>
            """))
            
            # --- THE PAUSE TRAP ---
            try:
                # Python sleeps here waiting for the JS string response
                action = output.eval_js(f"window.promise_{key_name}")
                
                # If the user clicked Stop, break the script entirely
                if action == "stop":
                    clear_output()
                    print("\n\u26A0\uFE0F Setup cancelled by user.")
                    raise StopExecution
                    
            except KeyboardInterrupt:
                clear_output()
                print("\n\u26A0\uFE0F Setup cancelled by user (KeyboardInterrupt).")
                raise StopExecution
    else:
        # --- JUPYTER / BINDER LOGIC ---
        # 1. Define what we are looking for
        filename = f".{key_name.lower()}"
        
        # 2. Start at the current working directory
        current_dir = os.path.abspath(os.getcwd())
        found_file_path = None

        # 3. Crawl UP the folder structure
        while True:
            potential_path = os.path.join(current_dir, filename)
            
            if os.path.exists(potential_path):
                found_file_path = potential_path
                break  # We found it! Stop searching.
                
            # Move up one level
            parent_dir = os.path.dirname(current_dir)
            
            # Check if we hit the root of the hard drive (e.g., C:\ or /)
            if current_dir == parent_dir:
                break  # Stop searching, it doesn't exist anywhere above us
                
            current_dir = parent_dir

        # 4. Set the final target_file path
        if found_file_path:
            target_file = found_file_path # Use the file we found up the tree
        else:
            target_file = os.path.join(os.getcwd(), filename) # Default to saving in cur

        # UI: Warning if existing file found (Local only)
        if not in_binder and os.path.exists(target_file):
            display(HTML(f"""<div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border-left: 6px solid #ffc107; font-family: sans-serif; max-width: 600px; margin-bottom: 10px;"><h4 style="margin-top: 0; color: #856404; margin-bottom: 5px;">&#9888;&#65039; WARNING: Key Already Exists</h4><p style="margin-top: 5px; color: #856404; margin-bottom: 0;">A saved key was already found in your vault.</p></div>"""))
            try:
                confirm = input("Do you want to OVERWRITE it? [y/N]: ")
                if confirm.strip().lower() not in ['yes', 'y']:
                    with open(target_file, "r") as f:
                        os.environ[key_name] = f.read().strip()
                    clear_output()
                    display(HTML("""<div style="margin-top: 10px; color: #155724; font-weight: bold; background: #d4edda; padding: 15px; border-radius: 8px; border-left: 6px solid #28a745; max-width: 600px;">&#10005; Setup cancelled. Your existing key was retained <b>and loaded into the environment!</b></div>"""))
                    return
            except KeyboardInterrupt:
                with open(target_file, "r") as f:
                    os.environ[key_name] = f.read().strip()
                clear_output()
                display(HTML("""<div style="margin-top: 10px; color: #155724; font-weight: bold; background: #d4edda; padding: 15px; border-radius: 8px; border-left: 6px solid #28a745; max-width: 600px;">&#10005; Interrupted. Your existing key was retained <b>and loaded into the environment!</b></div>"""))
                return
            clear_output()

        # UI: The Request Box
        if in_binder:
             display(HTML(f"""<div style="background-color: #e2e3e5; padding: 15px; border-radius: 8px; border-left: 6px solid #6c757d; font-family: sans-serif; max-width: 600px; margin-bottom: 10px;"><h3 style="margin-top: 0; color: #383d41; margin-bottom: 5px;">&#9201;&#65039; Ephemeral Session Setup</h3><p style="margin-top: 0; margin-bottom: 0;">You are running in a temporary session. Please paste your <b>{key_name}</b> below.<br><br><b>Note:</b> This key will only persist as long as this browser session remains active.</p></div>"""))
        else:
             display(HTML(f"""<div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 6px solid #4285f4; font-family: sans-serif; max-width: 600px; margin-bottom: 10px;"><h3 style="margin-top: 0; color: #1a73e8; margin-bottom: 5px;">&#128274; Secure Key Setup</h3><p style="margin-top: 0; margin-bottom: 0;">Please paste your <b>{key_name}</b> below. It will be safely vaulted as a hidden file.</p></div>"""))

        # The Input Loop
        print(f"Enter your {key_name} (or type 'quit' to cancel):")
        while True:
            try:
                key_input = getpass.getpass(prompt="> ").strip()
                if key_input.lower() in ['q', 'quit', 'cancel', 'exit']:
                    clear_output()
                    print("\n\u26A0\uFE0F Setup cancelled by user. No key was saved.")
                    return

                if key_input:
                    # VALIDATION INTERCEPT
                    if _validate_key(key_name, key_input):
                        clear_output()
                        break
                    else:
                        clear_output()
                        print(f"\u274C Invalid {key_name} detected! Authentication failed.")
                        print(f"Please check for typos and try again (or type 'quit' to cancel):")
                else:
                    clear_output()
                    print("\u26A0\uFE0F Input cannot be empty. Please paste your key (or type 'quit' to cancel):")
            except KeyboardInterrupt:
                clear_output()
                print("\n\u26A0\uFE0F Cell execution interrupted. Setup cancelled.")
                return

        # INJECT INTO ENVIRONMENT IMMEDIATELY
        os.environ[key_name] = key_input

        # Save Logic (Skip saving to disk if Binder)
        if in_binder:
            display(HTML(f"""<div style="margin-top: 10px; color: #137333; font-weight: bold; background: #e6f4ea; padding: 15px; border-radius: 8px; border-left: 6px solid #34a853; max-width: 600px;">&#127881; <b>Success! Key authenticated and loaded to environment.</b><br><span style="color: #0d652d; font-size: 0.9em;">(Remember: It will be cleared when this session ends.)</span></div>"""))
        else:
            try:
                with open(target_file, "w") as f: f.write(key_input)
                try: os.chmod(target_file, 0o600)
                except: pass
                display(HTML(f"""<div style="margin-top: 10px; color: #137333; font-weight: bold; background: #e6f4ea; padding: 15px; border-radius: 8px; border-left: 6px solid #34a853; max-width: 600px;">&#127881; <b>Success! Your key has been verified and safely vaulted in <code>{target_file}</code></b><br><span style="color: #0d652d; font-size: 0.9em;">&#128161; <b>Pro Tip:</b> Future notebooks will automatically load it!</span></div>"""))
            except Exception as e:
                clear_output()
                print(f"\n\u274C Error saving key: {e}")


def load_key_to_env(key_name="FRED_KEY"):
    """
    Silently loads the API key. If it fails, acts as a router to the Setup UI.
    """
    if os.environ.get(key_name): return

    in_colab = 'google.colab' in sys.modules
    if in_colab:
        try:
            from google.colab import userdata
            colab_key = userdata.get(key_name)
            if colab_key:
                os.environ[key_name] = colab_key
                return
        except: pass 

    dot_file = f".{key_name.lower()}"
    if os.path.exists(dot_file):
        with open(dot_file, "r") as f:
            saved_key = f.read().strip()
            if saved_key:
                os.environ[key_name] = saved_key
                return

    # IF ALL FAILS -> Route to Setup UI
    secure_key_setup(key_name)
    
    # The Colab Trap
    if in_colab:
        raise RuntimeError(f"[\u26A0\uFE0F] Setup required! Please complete the wizard above, then re-run this cell.")
```

:::

