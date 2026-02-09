#[cfg(test)]
mod tests {
    use super::super::*;
    use anchor_lang::prelude::*;

    #[test]
    fn test_get_vault_address() {
        let mint = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        
        let (vault_address, bump) = get_vault_address(&mint, &program_id);
        
        // Verify the PDA is derived correctly
        assert_ne!(vault_address, Pubkey::default());
        assert!(bump > 0 && bump <= 255);
        
        // Verify determinism - calling again with same params should return same result
        let (vault_address2, bump2) = get_vault_address(&mint, &program_id);
        assert_eq!(vault_address, vault_address2);
        assert_eq!(bump, bump2);
    }

    #[test]
    fn test_get_vault_address_different_mints() {
        let mint1 = Pubkey::new_unique();
        let mint2 = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        
        let (vault1, _) = get_vault_address(&mint1, &program_id);
        let (vault2, _) = get_vault_address(&mint2, &program_id);
        
        // Different mints should produce different vault addresses
        assert_ne!(vault1, vault2);
    }

    #[test]
    fn test_get_vault_authority_address() {
        let program_id = Pubkey::new_unique();
        
        let (authority_address, bump) = get_vault_authority_address(&program_id);
        
        // Verify the PDA is derived correctly
        assert_ne!(authority_address, Pubkey::default());
        assert!(bump > 0 && bump <= 255);
        
        // Verify determinism
        let (authority_address2, bump2) = get_vault_authority_address(&program_id);
        assert_eq!(authority_address, authority_address2);
        assert_eq!(bump, bump2);
    }

    #[test]
    fn test_get_vault_authority_address_different_programs() {
        let program_id1 = Pubkey::new_unique();
        let program_id2 = Pubkey::new_unique();
        
        let (authority1, _) = get_vault_authority_address(&program_id1);
        let (authority2, _) = get_vault_authority_address(&program_id2);
        
        // Different program IDs should produce different authority addresses
        assert_ne!(authority1, authority2);
    }

    #[test]
    fn test_vault_authority_structure() {
        let vault_authority = VaultAuthority {
            admin: Pubkey::new_unique(),
            bump: 255,
            jupiter_program_id: Pubkey::default(),
        };

        assert_ne!(vault_authority.admin, Pubkey::default());
        assert_eq!(vault_authority.bump, 255);
        assert_eq!(vault_authority.jupiter_program_id, Pubkey::default());
    }

    #[test]
    fn test_vault_authority_with_default_admin() {
        let vault_authority = VaultAuthority {
            admin: Pubkey::default(),
            bump: 128,
            jupiter_program_id: Pubkey::default(),
        };

        assert_eq!(vault_authority.admin, Pubkey::default());
        assert_eq!(vault_authority.bump, 128);
    }

    #[test]
    fn test_vault_address_consistency() {
        let mint = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        
        // Call multiple times to ensure consistency
        let results: Vec<(Pubkey, u8)> = (0..10)
            .map(|_| get_vault_address(&mint, &program_id))
            .collect();
        
        // All results should be identical
        let first = results[0];
        for result in results.iter().skip(1) {
            assert_eq!(result.0, first.0);
            assert_eq!(result.1, first.1);
        }
    }

    #[test]
    fn test_vault_authority_consistency() {
        let program_id = Pubkey::new_unique();
        
        // Call multiple times to ensure consistency
        let results: Vec<(Pubkey, u8)> = (0..10)
            .map(|_| get_vault_authority_address(&program_id))
            .collect();
        
        // All results should be identical
        let first = results[0];
        for result in results.iter().skip(1) {
            assert_eq!(result.0, first.0);
            assert_eq!(result.1, first.1);
        }
    }

    #[test]
    fn test_vault_exists_empty_accounts() {
        let mint = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        let remaining_accounts: Vec<AccountInfo> = vec![];
        
        let exists = vault_exists(&remaining_accounts, &mint, &program_id);
        assert!(!exists);
    }

    #[test]
    fn test_vault_address_seeds() {
        let mint = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        
        let (vault_address, bump) = get_vault_address(&mint, &program_id);
        
        // Manually verify the PDA derivation
        let seeds = &[b"vault", mint.as_ref(), &[bump]];
        let (expected_address, _) = Pubkey::find_program_address(
            &[b"vault", mint.as_ref()],
            &program_id
        );
        
        assert_eq!(vault_address, expected_address);
    }

    #[test]
    fn test_vault_authority_seeds() {
        let program_id = Pubkey::new_unique();
        
        let (authority_address, bump) = get_vault_authority_address(&program_id);
        
        // Manually verify the PDA derivation
        let (expected_address, _) = Pubkey::find_program_address(
            &[b"vault_authority"],
            &program_id
        );
        
        assert_eq!(authority_address, expected_address);
    }

    #[test]
    fn test_multiple_vaults_for_same_program() {
        let program_id = Pubkey::new_unique();
        let mints: Vec<Pubkey> = (0..5).map(|_| Pubkey::new_unique()).collect();
        
        let vaults: Vec<(Pubkey, u8)> = mints
            .iter()
            .map(|mint| get_vault_address(mint, &program_id))
            .collect();
        
        // All vaults should be unique
        for i in 0..vaults.len() {
            for j in (i + 1)..vaults.len() {
                assert_ne!(vaults[i].0, vaults[j].0);
            }
        }
    }

    #[test]
    fn test_vault_authority_bump_range() {
        let program_id = Pubkey::new_unique();
        let (_, bump) = get_vault_authority_address(&program_id);
        
        // Bump should be a valid value (typically 255 or close to it for first PDA)
        assert!(bump > 0 && bump <= 255);
    }

    #[test]
    fn test_vault_address_bump_range() {
        let mint = Pubkey::new_unique();
        let program_id = Pubkey::new_unique();
        let (_, bump) = get_vault_address(&mint, &program_id);
        
        // Bump should be a valid value
        assert!(bump > 0 && bump <= 255);
    }
}
