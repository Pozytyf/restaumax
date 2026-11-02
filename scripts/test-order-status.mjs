import { getOrderStatusPresentation } from '../src/utils/orderStatus.ts';

const cases = [
  ['pending', 'Commande reçue', 'Votre commande a bien été reçue'],
  ['in_prep', 'En préparation', 'Votre commande est en préparation !'],
  ['ready', 'Prête', 'Votre commande est prête !'],
  ['completed', 'Terminée', 'Votre commande est terminée'],
  ['cancelled', 'Annulée', 'Votre commande a été annulée']
];

let failed = 0;

for (const [status, expectedLabel, expectedHeadline] of cases) {
  const presentation = getOrderStatusPresentation(status);
  const passed = presentation.label === expectedLabel && presentation.headline === expectedHeadline;

  if (passed) {
    console.log(`✓ Statut ${status} : libellé et message cohérents`);
  } else {
    failed++;
    console.error(`✗ Statut ${status} : résultat inattendu`, presentation);
  }
}

if (failed > 0) {
  console.error(`Échec : ${failed} cas sur ${cases.length}`);
  process.exitCode = 1;
} else {
  console.log(`Succès : ${cases.length} statuts vérifiés`);
}
