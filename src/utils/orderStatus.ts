import type { RestauOrderStatus } from '../types/restaumax';

export interface OrderStatusPresentation {
  headline: string;
  label: string;
  helperTitle: string;
  helperMessage: string;
}

const ORDER_STATUS_PRESENTATION: Record<RestauOrderStatus, OrderStatusPresentation> = {
  pending: {
    headline: 'Votre commande a bien été reçue',
    label: 'Commande reçue',
    helperTitle: 'Commande transmise',
    helperMessage: "L'équipe du restaurant a reçu votre ticket. Conservez votre numéro de ticket pour toute demande de suivi."
  },
  in_prep: {
    headline: 'Votre commande est en préparation !',
    label: 'En préparation',
    helperTitle: 'Préparation en cours',
    helperMessage: "L'équipe du restaurant prépare votre commande. Conservez votre numéro de ticket pour toute demande de suivi."
  },
  ready: {
    headline: 'Votre commande est prête !',
    label: 'Prête',
    helperTitle: 'À récupérer',
    helperMessage: 'Votre commande est prête. Présentez votre numéro de ticket au personnel du restaurant.'
  },
  completed: {
    headline: 'Votre commande est terminée',
    label: 'Terminée',
    helperTitle: 'Commande terminée',
    helperMessage: 'Cette commande est marquée comme terminée. Merci de votre confiance.'
  },
  cancelled: {
    headline: 'Votre commande a été annulée',
    label: 'Annulée',
    helperTitle: 'Commande annulée',
    helperMessage: "Cette commande est annulée. Adressez-vous au personnel du restaurant pour toute précision."
  }
};

export function getOrderStatusPresentation(status: RestauOrderStatus): OrderStatusPresentation {
  return ORDER_STATUS_PRESENTATION[status];
}
