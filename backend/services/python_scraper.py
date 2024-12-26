import sys
import os
import subprocess
import json

def setup_environment():
    try:
        # התקנת pip אם לא קיים
        try:
            subprocess.check_call([sys.executable, '-m', 'ensurepip', '--default-pip'])
            print(json.dumps({"status": "Successfully installed pip"}, ensure_ascii=False))
        except:
            print(json.dumps({"status": "Pip is already installed"}, ensure_ascii=False))

        # יצירת והפעלת venv אם לא קיים
        venv_path = os.path.join(os.path.dirname(__file__), '../venv')
        if not os.path.exists(venv_path):
            subprocess.check_call([sys.executable, '-m', 'venv', venv_path])
            print(json.dumps({"status": "Created virtual environment"}, ensure_ascii=False))

        # הפעלת הסביבה הווירטואלית
        if os.name == 'nt':  # Windows
            activate_script = os.path.join(venv_path, 'Scripts', 'activate.bat')
        else:  # Linux/Mac
            activate_script = os.path.join(venv_path, 'bin', 'activate')

        if os.path.exists(activate_script):
            if os.name == 'nt':
                os.system(f'call {activate_script}')
            else:
                os.system(f'source {activate_script}')
            print(json.dumps({"status": "Activated virtual environment"}, ensure_ascii=False))
        
        # שדרוג pip בסביבה הווירטואלית
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'])
        print(json.dumps({"status": "Upgraded pip"}, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            "error": "Failed to setup environment",
            "details": str(e)
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

def install_requirements():
    try:
        requirements_path = os.path.join(os.path.dirname(__file__), '../requirements.txt')
        if os.path.exists(requirements_path):
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', requirements_path])
            print(json.dumps({"status": "Successfully installed requirements"}, ensure_ascii=False))
        else:
            print(json.dumps({"error": "requirements.txt not found"}, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "error": "Failed to install requirements",
            "details": str(e)
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

# הגדרת הסביבה והתקנת חבילות
setup_environment()
install_requirements()

import requests
import json
import warnings
import urllib3
import traceback
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.core.os_manager import ChromeType

# ביטול כל האזהרות הקשורות ל-SSL
warnings.filterwarnings('ignore', message='Unverified HTTPS request')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def setup_driver():
    try:
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument('--disable-notifications')
        chrome_options.add_argument('--disable-extensions')
        chrome_options.add_argument('--disable-infobars')
        
        # התקנת Chrome באופן מפורש
        os.system('apt-get update && apt-get install -y chromium-browser')
        
        # הגדרת הנתיב ל-Chrome
        chrome_options.binary_location = '/usr/bin/chromium-browser'
        
        service = Service(ChromeDriverManager(chrome_type=ChromeType.CHROMIUM).install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        return driver
    except Exception as e:
        error_msg = {
            "error": "Failed to setup Chrome driver",
            "details": str(e),
            "trace": traceback.format_exc()
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

def scrape_event_data(url):
    driver = None
    try:
        driver = setup_driver()
        
        # טעינת הדף
        driver.get(url)
        
        # המתנה לטעינת התוכן
        try:
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
        except TimeoutException:
            raise Exception("Page load timeout")
        
        # חילוץ הכותרת
        title = driver.title.strip()
        if not title:
            raise Exception("Failed to extract title")
        
        # חילוץ תמונה
        try:
            image = driver.find_element(By.CSS_SELECTOR, 'meta[property="og:image"]').get_attribute('content')
        except NoSuchElementException:
            # נסה למצוא תמונה בדרכים אחרות
            try:
                image = driver.find_element(By.CSS_SELECTOR, 'img[src*="header"], img[src*="main"], img[src*="hero"]').get_attribute('src')
            except NoSuchElementException:
                image = None
        
        # חילוץ תאריך
        date_text = None
        try:
            elements = driver.find_elements(By.XPATH, "//*[contains(text(), '05:30') or contains(text(), '23:30')]")
            if elements:
                date_text = elements[0].text.strip()
        except Exception:
            pass
        
        result = {
            "eventName": _cleanEventName(title),
            "imageUrl": image,
            "eventDate": date_text,
            "url": url
        }
        
        print(json.dumps(result, ensure_ascii=False))
        return result
            
    except Exception as e:
        error_msg = {
            "error": str(e),
            "details": traceback.format_exc(),
            "url": url
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        return None
        
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

def _cleanEventName(eventName):
    if not eventName:
        return ""
    return eventName.replace("כרטיסים ", "").strip()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1]
        scrape_event_data(url)
    else:
        print(json.dumps({"error": "No URL provided"}, ensure_ascii=False), file=sys.stderr) 