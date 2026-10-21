// Snapshot of the Fabric Master DB master tabs (21 Oct 2026), only the columns the planner uses.
const rows = (head, data) => data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
const U = 'u_mvdwlskosl2i';

export const tabs = {
  Units: rows(['id', 'name', 'tfo_default_eff', 'loom_eff_pct'], [[U, 'Weavelon 2', '85', '93']]),
  LoomGroups: rows(['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms'], [
    ['lg_mvdwlskoejlg', U, 'Toyota', '190', 'Plain', '16'],
    ['lg_mvdwlskopkjb', U, 'Toyota', '280', 'Dobby', '14'],
    ['lg_w2_190dobby', U, 'Toyota', '190', 'Dobby', '24'],
    ['lg_w2_280plain', U, 'Toyota', '280', 'Plain', '18']
  ]),
  TfoTypes: rows(['id', 'unit_id', 'name', 'machines', 'spindles_per_side', 'efficiency', 'doff_g_per_spindle'], [
    ['tt_mvdwlskor31b', U, 'New machines (13-16)', '4', '252', '70', ''],
    ['tt_mvdwlskof702', U, 'Old machines (1-12)', '12', '', '80', '']
  ]),
  TfoSpeeds: rows(['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency'], [
    ['s1', U, 'tt_mvdwlskor31b', 'y_mvdvpxsy37ao', '18000', ''],
    ['s2', U, 'tt_mvdwlskof702', 'y_mvdvpxsy37ao', '20000', ''],
    ['s3', U, 'tt_mvdwlskof702', 'y_mvgf6t7qv7ff', '23000', ''],
    ['s4', U, 'tt_mvdwlskof702', 'y_mvgf6t7ue66p', '18000', ''],
    ['s5', U, 'tt_mvdwlskof702', 'y_mvgf6t7ye4oz', '20000', ''],
    ['s6', U, 'tt_mvdwlskof702', 'y_mvgf6t827a34', '20000', ''],
    ['s7', U, 'tt_mvdwlskor31b', 'y_mvgf6t827a34', '18000', '']
  ]),
  Yarns: rows(['id', 'name', 'kind', 'base_yarn_id', 'count', 'count_unit', 'tpm'], [
    ['y_mvdvoz3rmung', '60/08', 'base', '', '60', 'D', ''],
    ['y_mvdvpxsy37ao', '60/08 1109 TPM', 'tpm', 'y_mvdvoz3rmung', '62', 'D', '1109'],
    ['y_mvgf6t7ouidh', '80/48 BSY', 'base', '', '80', 'D', ''],
    ['y_mvgf6t7qv7ff', '80/48 BSY 1525 TPM', 'tpm', 'y_mvgf6t7ouidh', '86', 'D', '1525'],
    ['y_mvgf6t7tb451', '120/30 BRT', 'base', '', '120', 'D', ''],
    ['y_mvgf6t7ue66p', '120/30 BRT 504 TPM', 'tpm', 'y_mvgf6t7tb451', '125', 'D', '504'],
    ['y_mvgf6t7xf512', '58/24 VIS', 'base', '', '58', 'D', ''],
    ['y_mvgf6t7ye4oz', '58/24 VIS 1109 TPM', 'tpm', 'y_mvgf6t7xf512', '60', 'D', '1109'],
    ['y_mvgf6t8195rf', '60/24 VISCOSE', 'base', '', '60', 'D', ''],
    ['y_mvgf6t827a34', '60/24 VISCOSE 1650 TPM', 'tpm', 'y_mvgf6t8195rf', '65', 'D', '1650'],
    ['y_mvgfrkvq13ya', '60/24 SIZED', 'base', '', '60', 'D', ''],
    ['y_mvggl7wlcl2q', '20/1 NYLON SD BEAM', 'base', '', '20', 'D', ''],
    ['y_mvgig639k9jq', '20 Nylon Jari S/Z', 'base', '', '88', 'D', ''],
    ['y_mvgig63bfy6w', '20 Nylon Gold S/Z', 'base', '', '88', 'D', ''],
    ['y_mvgig63dql3x', '20/1 Nylon SD Weft', 'base', '', '20', 'D', ''],
    ['y_mvgig63fkh1l', 'Matte Zari', 'base', '', '110', 'D', ''],
    ['y_mvgig63g9rsc', '60 Ecovero', 'base', '', '60', 'Ne', '']
  ]),
  Fabrics: rows(['id', 'name', 'weave', 'design_note', 'ppi', 'reed_space_in', 'warp_shortage_pct', 'weft_shortage_pct', 'loom_rpm', 'loom_rpm_dp'], [
    ['f_mvgcdsr22g7z', 'Organza Twill', 'Dobby', '', '80', '49', '10', '10', '1004', '700'],
    ['f_mvgig63hjeal', 'Rangila Twill', 'Dobby', 'Rangila Twill (5404)', '68', '54', '10', '10', '1003', '679'],
    ['f_mvgig63l89g1', 'Natural Crape', 'Plain', '', '80', '52.5', '10', '10', '1026', '672'],
    ['f_mvgig63pg5i3', 'Natural Crape', 'Plain', '', '80', '67', '10', '10', '1041', ''],
    ['f_mvgig63tfc5n', 'Gajji Silk', 'Dobby', '', '76', '64', '10', '10', '998', '700'],
    ['f_mvgig63xrhbj', 'Gajji Silk', 'Dobby', '', '76', '73', '10', '10', '997', ''],
    ['f_mvgig6414tkx', 'Gajji Silk', 'Dobby', '', '76', '41', '10', '10', '', '843'],
    ['f_mvgig6450w8e', 'Salsa Butty', 'Dobby', '', '80', '70', '10', '10', '970', ''],
    ['f_mvgig64bn9wd', 'Salsa Butty', 'Dobby', '', '80', '54', '10', '10', '', '604'],
    ['f_mvgig64heavr', 'Salsa', 'Plain', '', '80', '54', '10', '10', '998', '679'],
    ['f_mvgig64mgmi8', 'Tissue', 'Plain', '', '74', '64', '10', '10', '975', ''],
    ['f_mvgig64r8ova', 'Tissue Gold', 'Plain', '', '74', '50', '10', '10', '', '666'],
    ['f_mvgne94s8x05', 'Natural Crape', 'Plain', '', '80', '74', '10', '10', '1041', ''],
    ['f_mvhq3i4rlp91', 'Organza Twill', 'Dobby', '', '80', '50', '10', '10', '1004', '700']
  ]),
  Assignments: [],
  FabricYarns: rows(['fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'sort'], [
    ['f_mvgcdsr22g7z', 'warp', 'y_mvdvpxsy37ao', '4896', '', '1'], ['f_mvgcdsr22g7z', 'weft', 'y_mvdvpxsy37ao', '', '1', '2'],
    ['f_mvgig63hjeal', 'warp', 'y_mvgf6t7qv7ff', '8368', '', '1'], ['f_mvgig63hjeal', 'weft', 'y_mvgf6t7ue66p', '', '1', '2'],
    ['f_mvgig63l89g1', 'warp', 'y_mvgfrkvq13ya', '7000', '', '1'], ['f_mvgig63l89g1', 'weft', 'y_mvgf6t827a34', '', '1', '2'],
    ['f_mvgig63pg5i3', 'warp', 'y_mvgfrkvq13ya', '9000', '', '1'], ['f_mvgig63pg5i3', 'weft', 'y_mvgf6t827a34', '', '1', '2'],
    ['f_mvgig63tfc5n', 'warp', 'y_mvgfrkvq13ya', '12920', '', '1'], ['f_mvgig63tfc5n', 'weft', 'y_mvgig63g9rsc', '', '1', '2'],
    ['f_mvgig63xrhbj', 'warp', 'y_mvgfrkvq13ya', '14744', '', '1'], ['f_mvgig63xrhbj', 'weft', 'y_mvgig63g9rsc', '', '1', '2'],
    ['f_mvgig6414tkx', 'warp', 'y_mvgfrkvq13ya', '8250', '', '1'], ['f_mvgig6414tkx', 'weft', 'y_mvgig63g9rsc', '', '1', '2'],
    ['f_mvgig6450w8e', 'warp', 'y_mvggl7wlcl2q', '7872', '', '1'], ['f_mvgig6450w8e', 'weft', 'y_mvgig639k9jq', '', '31.04', '2'], ['f_mvgig6450w8e', 'weft', 'y_mvgig63dql3x', '', '31.04', '3'], ['f_mvgig6450w8e', 'weft', 'y_mvgig63fkh1l', '', '17.92', '4'],
    ['f_mvgig64bn9wd', 'warp', 'y_mvggl7wlcl2q', '5754', '', '1'], ['f_mvgig64bn9wd', 'weft', 'y_mvgig639k9jq', '', '31.04', '2'], ['f_mvgig64bn9wd', 'weft', 'y_mvgig63dql3x', '', '31.04', '3'], ['f_mvgig64bn9wd', 'weft', 'y_mvgig63fkh1l', '', '17.92', '4'],
    ['f_mvgig64heavr', 'warp', 'y_mvggl7wlcl2q', '6240', '', '1'], ['f_mvgig64heavr', 'weft', 'y_mvgig639k9jq', '', '40', '2'], ['f_mvgig64heavr', 'weft', 'y_mvgig63dql3x', '', '40', '3'],
    ['f_mvgig64mgmi8', 'warp', 'y_mvgfrkvq13ya', '5728', '', '1'], ['f_mvgig64mgmi8', 'weft', 'y_mvgf6t7ye4oz', '', '37', '2'], ['f_mvgig64mgmi8', 'weft', 'y_mvgig63bfy6w', '', '37', '3'],
    ['f_mvgig64r8ova', 'warp', 'y_mvgfrkvq13ya', '4400', '', '1'], ['f_mvgig64r8ova', 'weft', 'y_mvgf6t7ye4oz', '', '37', '2'], ['f_mvgig64r8ova', 'weft', 'y_mvgig63bfy6w', '', '37', '3'],
    ['f_mvgne94s8x05', 'warp', 'y_mvgfrkvq13ya', '9940', '', '1'], ['f_mvgne94s8x05', 'weft', 'y_mvgf6t827a34', '', '1', '2'],
    ['f_mvhq3i4rlp91', 'warp', 'y_mvdvpxsy37ao', '4996', '', '1'], ['f_mvhq3i4rlp91', 'weft', 'y_mvdvpxsy37ao', '', '1', '2']
  ]),
  FabricBeams: rows(['id', 'fabric_id', 'loom_group_id', 'beam_length_m'], [['fb_mvhvvok6zbdu', 'f_mvgig63xrhbj', 'lg_mvdwlskoejlg', '7000']])
};
tabs.Assignments = tabs.Fabrics.map((f) => ({ fabric_id: f.id, unit_id: U }));
