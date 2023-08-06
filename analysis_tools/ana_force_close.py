import os
import sys
from utils import *

STORAGEPATH = os.path.split(os.path.split(os.path.abspath(__file__))[0])[0] + '/data/'
SRCFILE = "liquidated_list.json"
TGTFILE = "ana_force_close.json"

def analyze_accounts(filename: str, N: int):
    liquidated_list = load_json_file(filename)
    ForceClose_list = []
    for account in liquidated_list:
        if account['borrowedSum'] > account['collateralSum']:
            ForceClose_list.append(account)
   
    # sort
    ForceClose_list = sorted(ForceClose_list, key=lambda d: d['borrowedSum'], reverse = True) 
   
    # take the first N if N > 0
    if N > 0 and len(ForceClose_list) > N:
        ForceClose_list = ForceClose_list[:N]
      
   
    save_json_file(STORAGEPATH+TGTFILE, ForceClose_list)
   
   
if __name__=="__main__":
    N = 0
    if len(sys.argv) > 1:
        N = max(0,int(sys.argv[1]))
        if N > 0:
            print("Display Top "+str(N)+" accounts")
        else:
            print("Display all accounts")

    analyze_accounts(STORAGEPATH+SRCFILE, N)