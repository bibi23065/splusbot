"""
Soroush+ Authentication Script
Run this locally to get a session token, then paste it into the Telegram bot.

Usage:
    pip install aiohttp
    python auth.py
"""

import asyncio
import aiohttp
import json
import sys
import os

SPLUS_API_BASE = "https://api.splus.ir"
WEB_BASE = "https://web.splus.ir"

async def try_send_sms(session, phone):
    """Try multiple known Soroush+ SMS endpoints"""
    endpoints = [
        f"{SPLUS_API_BASE}/sendSMS/",
        f"{SPLUS_API_BASE}/activation/",
        f"https://wslb2.soroush-hamrah.ir/sendSMS/",
        f"https://wslb2.soroush-hamrah.ir/activation/",
    ]
    
    payload = json.dumps({
        "PhoneNumber": phone,
        "DeviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "PlatformType": 1,
        "AppVersion": "3.9.1"
    })
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://web.splus.ir",
        "Referer": "https://web.splus.ir/",
    }
    
    for url in endpoints:
        try:
            print(f"  Trying {url}...")
            async with session.post(url, data=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                text = await resp.text()
                print(f"  Status: {resp.status}, Response: {text[:200]}")
                if resp.status == 200:
                    try:
                        data = json.loads(text)
                        return True, data
                    except:
                        pass
        except Exception as e:
            print(f"  Error: {e}")
    
    return False, None


async def try_verify_code(session, phone, code):
    """Try multiple known Soroush+ verification endpoints"""
    endpoints = [
        f"{SPLUS_API_BASE}/Voucher/Verify/",
        f"{SPLUS_API_BASE}/register/",
        f"https://wslb2.soroush-hamrah.ir/Voucher/Verify/",
        f"https://wslb2.soroush-hamrah.ir/register/",
    ]
    
    payload = json.dumps({
        "PhoneNumber": phone,
        "Code": code,
        "DeviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "PlatformType": 1,
        "AppVersion": "3.9.1"
    })
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://web.splus.ir",
        "Referer": "https://web.splus.ir/",
    }
    
    for url in endpoints:
        try:
            print(f"  Trying {url}...")
            async with session.post(url, data=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                text = await resp.text()
                print(f"  Status: {resp.status}, Response: {text[:300]}")
                if resp.status == 200:
                    try:
                        data = json.loads(text)
                        return True, data
                    except:
                        pass
        except Exception as e:
            print(f"  Error: {e}")
    
    return False, None


async def extract_from_browser():
    """Alternative: extract session from browser localStorage"""
    print("\n--- Browser Extraction Method ---")
    print("If the direct API methods above failed, you can extract the session from your browser:")
    print()
    print("1. Open https://web.splus.ir in Chrome")
    print("2. Log in with your phone number")
    print("3. Press F12 to open DevTools")
    print("4. Go to Application tab -> Local Storage -> https://web.splus.ir")
    print("5. Look for these keys:")
    print("   - 'GramJs:sessionId' (the MTProto session)")
    print("   - 'user_auth' (authentication state)")
    print("6. Copy the values and create a JSON:")
    print()
    print('   {"sessionId": "...", "auth": {...}}')
    print()
    print("7. Paste that JSON when the bot asks for the token")


async def main():
    print("=== Soroush+ Authentication ===\n")
    
    phone = input("Enter your Soroush+ phone number (e.g. 0912xxxxxxx): ").strip()
    phone = phone.replace("+98", "0").replace("-", "").replace(" ", "")
    
    if not phone.startswith("0") or len(phone) != 11:
        print("Invalid phone number format. Use 09xxxxxxxxx")
        return
    
    async with aiohttp.ClientSession() as session:
        print(f"\nSending SMS to {phone}...")
        success, data = await try_send_sms(session, phone)
        
        if success and data:
            print(f"\nSMS sent successfully!")
            print(f"Response data: {json.dumps(data, indent=2)[:500]}")
            
            code = input("\nEnter the SMS verification code: ").strip()
            
            print("\nVerifying code...")
            success2, data2 = await try_verify_code(session, phone, code)
            
            if success2 and data2:
                print(f"\nAuthentication successful!")
                
                session_data = {
                    "phone": phone,
                    "token": data2.get("Token") or data2.get("token") or data2.get("AccessToken", ""),
                    "userId": data2.get("UserId") or data2.get("userId") or data2.get("UserID", ""),
                    "cookies": data2.get("Cookies") or data2.get("SetCookie") or {},
                }
                
                token_str = json.dumps(session_data)
                
                print(f"\n{'='*60}")
                print(f"COPY THE LINE BELOW INTO TELEGRAM:")
                print(f"{'='*60}")
                print(token_str)
                print(f"{'='*60}")
                
                # Also save to file
                with open("splus_session.json", "w") as f:
                    json.dump(session_data, f, indent=2)
                print(f"\nSession also saved to splus_session.json")
            else:
                print("\nVerification failed. The direct API endpoints may be deprecated.")
                await extract_from_browser()
        else:
            print("\nDirect SMS API failed. The REST API endpoints may be deprecated.")
            print("\nPlease use the browser extraction method instead:")
            await extract_from_browser()


if __name__ == "__main__":
    asyncio.run(main())
