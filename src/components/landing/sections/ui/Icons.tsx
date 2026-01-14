import React from 'react';
import { FaWhatsapp, FaInstagram, FaFacebook, FaStore } from 'react-icons/fa6';

export const WhatsAppIcon = (props: { className?: string; size?: number }) => <FaWhatsapp {...props} />;
export const InstagramIcon = (props: { className?: string; size?: number }) => <FaInstagram {...props} />;
export const FacebookIcon = (props: { className?: string; size?: number }) => <FaFacebook {...props} />;
export const MercadoLivreIcon = (props: { className?: string; size?: number }) => <FaStore {...props} />;
