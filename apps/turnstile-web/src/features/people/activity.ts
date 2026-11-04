import { createContext, useContext } from 'react';

// Draft owners stay mounted for the same subject while their owning APIs are blocked.
export const PeopleActivity = createContext(true);
export const usePeopleActivity = () => useContext(PeopleActivity);
