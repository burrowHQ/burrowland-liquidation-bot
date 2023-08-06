import os
import sys
from utils import *

STORAGEPATH = os.path.split(os.path.split(os.path.abspath(__file__))[0])[0] + '/data/'
SRCFILE = "liquidated_list.json"
TGTFILE = "ana_col_token.json"

def analyze_accounts(filename: str, token_id: str):
    liquidated_list = load_json_file(filename)

    target_list = []
    for account in liquidated_list:
        collaterals = account['collateral']
        for collateral in collaterals:
            if collateral['tokenId'] == token_id:
                target_list.append(account)
                break
    
   
    # sort
    target_list = sorted(target_list, key=lambda d: d['adjustedBorrowedSum'], reverse = True) 
   
    save_json_file(STORAGEPATH+TGTFILE, target_list)
   
   
if __name__=="__main__":

    if len(sys.argv) != 2:
        print("Need designate collateral token id")
        exit(0)

    col_token_id = sys.argv[1]

    analyze_accounts(STORAGEPATH+SRCFILE, col_token_id)