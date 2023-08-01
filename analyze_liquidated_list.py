import os
import sys
import json

FILENAME = "liquidated_list.json"

def OpenFile(filepath):
   with open(filepath, mode='r', encoding="utf-8") as f:
      json_obj = json.load(f)
   return json_obj

def save2file(filepath, json_obj, sort_keys=False):
    with open(filepath, mode='w', encoding="utf-8") as f:
        json.dump(json_obj, f, indent = 2, sort_keys = sort_keys)
        print("%s saved" % filepath)

def analyze_accounts(filename: str, N: int):
   liquidated_list = OpenFile(filename)
   ForceClose_list = []
   for account in liquidated_list:
      if account['borrowedSum'] > account['collateralSum']:
         ForceClose_list.append(account)
   
   # sort
   ForceClose_list = sorted(ForceClose_list, key=lambda d: d['borrowedSum']) 
   
   # take the first N if N > 0
   if N > 0 and len(ForceClose_list) > N:
      ForceClose_list = ForceClose_list[:N]
      
   
   save2file("ForceClose_list.json", ForceClose_list)
   
   
if __name__=="__main__":
   N = 0
   if len(sys.argv) > 1:
      N = max(0,int(sys.argv[1]))
      if N > 0:
         print("Display Top "+str(N)+" accounts")
      else:
         print("Display all accounts")
   analyze_accounts(FILENAME, N)